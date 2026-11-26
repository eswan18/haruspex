/**
 * Boots the built app against a real Postgres and a stub IdP, in that order:
 * Postgres, stub, seed, app. The app runs as production runs it: the
 * standalone `server.js` (see harness.ts). It exits at boot unless its
 * database is migrated, which is why this is not Playwright's `webServer`
 * (that starts before global setup).
 *
 * Global teardown runs even when this throws part-way, and stops whatever had
 * been started.
 */
import fs from "node:fs";
import path from "node:path";

import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

import type { Database } from "@/types/db_types";
import { setup as startDatabase } from "../tests/globalSetup";
import {
  APP_HOST,
  APP_PORT,
  APP_URL,
  IDP_PORT,
  ROOT,
  STATE,
  assertPortFree,
  clearEarlierRun,
  startApp,
  trackStub,
} from "./support/harness";
import {
  AUDIENCE,
  CLIENT_ID,
  CLIENT_SECRET,
  startIdpStub,
  type IdpStub,
} from "./support/idp-stub";
import { seed, type Seed, type TestUser } from "./support/seed";

/**
 * What the app's process inherits from this one. Nothing else: a developer's
 * shell may hold DATABASE_URL, MCP_RESOURCE_URL, a Sentry DSN, or the
 * TEST_*_DATABASE_URLs, and the app must see none of them.
 */
const INHERITED_ENV = ["PATH", "HOME", "TMPDIR", "USER", "LANG", "TZ"];

function appEnv(databaseUrl: string, idpUrl: string): NodeJS.ProcessEnv {
  const inherited: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    const value = process.env[name];
    if (value !== undefined) inherited[name] = value;
  }
  return {
    ...inherited,
    NODE_ENV: "production",
    // As in the cluster (k8s/haruspex-base/configmap.yaml). Without it,
    // instrumentation.ts loads a developer's `.env.local` over these values,
    // and where there is none, answers every request with a 500.
    K8S: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: databaseUrl,
    IDP_BASE_URL: idpUrl,
    IDP_PUBLIC_URL: idpUrl,
    IDP_AUDIENCE: AUDIENCE,
    IDP_CLIENT_ID: CLIENT_ID,
    IDP_CLIENT_SECRET: CLIENT_SECRET,
    JWT_SECRET: "e2e",
    APP_BASE_URL: APP_URL,
    PUBSUB_TOPIC: "e2e",
    GCP_PROJECT_ID: "e2e",
  };
}

/** Signs `who` in; returns the session token it wrote. */
async function writeStorageState(
  file: string,
  stub: IdpStub,
  who: TestUser,
): Promise<string> {
  if (!who.idp_user_id)
    throw new Error(`Seeded user ${who.id} has no idp_user_id`);
  const token = await stub.mintToken({
    sub: who.idp_user_id,
    email: who.email,
    username: who.username ?? undefined,
  });
  const state = {
    cookies: [
      {
        name: "token",
        value: token,
        domain: APP_HOST,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  return token;
}

export default async function globalSetup(): Promise<void> {
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    throw new Error('Run "npm run build" first');
  }
  await clearEarlierRun();
  await assertPortFree(APP_PORT);
  await assertPortFree(IDP_PORT);

  process.env.TEST_USE_CONTAINERS = "true";
  await startDatabase();
  const ownerUrl = process.env.TEST_DATABASE_URL;
  const appUserUrl = process.env.TEST_RLS_DATABASE_URL;
  if (!ownerUrl || !appUserUrl) {
    throw new Error("tests/globalSetup.ts did not set the test database URLs");
  }

  const stub = await startIdpStub(IDP_PORT);
  trackStub(stub);

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: ownerUrl, max: 2, ssl: false }),
    }),
  });
  let data: Seed;
  let readerToken: string;
  try {
    // tests/helpers/migrator.ts records its baseline schema as a migration,
    // "00000000_bootstrap". The app's boot check (lib/migrations/check.ts)
    // knows only migrations/, so it would refuse this database as "ahead of
    // this build" and exit. Production's migration table has no such row: its
    // baseline predates kysely.
    await sql`delete from kysely_migration where name = '00000000_bootstrap'`.execute(
      db,
    );
    data = await seed(db);
    fs.writeFileSync(STATE.seed, JSON.stringify(data, null, 2));
    readerToken = await writeStorageState(STATE.user, stub, data.user);
    await writeStorageState(STATE.admin, stub, data.admin);
    // Only this process holds the stub's signing key, so the token a spec
    // needs for the wrong-audience check is minted here.
    fs.writeFileSync(
      STATE.wrongAudienceToken,
      await stub.mintToken({
        sub: data.user.idp_user_id!,
        email: data.user.email,
        aud: "ethanswan:other",
      }),
    );
  } finally {
    await db.destroy();
  }

  // app_user owns nothing, so row-level security applies to the app as it
  // does in production, where the app's role is not the owner either. The
  // reader's token is how readiness tells this run's app from any other
  // server on the port (see startApp).
  await startApp(appEnv(appUserUrl, stub.url), {
    token: readerToken,
    user: {
      id: data.user.id,
      idp_user_id: data.user.idp_user_id!,
      email: data.user.email,
    },
  });
}
