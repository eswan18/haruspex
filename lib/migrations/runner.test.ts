import { promises as fs } from "node:fs";
import { isBuiltin } from "node:module";
import * as path from "node:path";

import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertMatchesManifest,
  renderEntry,
} from "@/scripts/build-migration-runner";
import {
  buildRunnerArtifact,
  runArtifact,
  type RunnerArtifact,
} from "@/tests/helpers/migrationRunnerArtifact";

import { MIGRATION_MANIFEST } from "./manifest";
import {
  StaticMigrationProvider,
  checkCompiledSet,
  describeConnection,
  runMigrationCli,
  runMigrations,
  type RunnerIo,
} from "./runner";

/** The name tests/helpers/migrator.ts prepends. It must never be compiled. */
const HARNESS_BOOTSTRAP = "00000000_bootstrap";

const noopMigration: Migration = { up: async () => {} };

function capturingIo() {
  const info: string[] = [];
  const error: string[] = [];
  const io: RunnerIo = {
    info: (line) => {
      info.push(line);
    },
    error: (line) => {
      error.push(line);
    },
  };
  return { io, info, error };
}

/** A database that fails loudly if anything touches it. */
function unusableDb(): Kysely<unknown> {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("the runner touched the database when it should not");
      },
    },
  ) as unknown as Kysely<unknown>;
}

describe("StaticMigrationProvider", () => {
  it("serves exactly the migrations it was given", async () => {
    const provider = new StaticMigrationProvider({
      a: noopMigration,
      b: noopMigration,
    });

    expect(Object.keys(await provider.getMigrations()).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("hands out a copy, so kysely cannot mutate the compiled set", async () => {
    const provider = new StaticMigrationProvider({ a: noopMigration });

    delete (await provider.getMigrations()).a;

    expect(Object.keys(await provider.getMigrations())).toEqual(["a"]);
  });
});

describe("checkCompiledSet", () => {
  it("accepts exactly the build's manifest", () => {
    expect(checkCompiledSet(MIGRATION_MANIFEST)).toBeNull();
  });

  it("accepts the manifest in any order", () => {
    expect(checkCompiledSet([...MIGRATION_MANIFEST].reverse())).toBeNull();
  });

  it("rejects the test harness's bootstrap migration", () => {
    // The trap this guard exists for: tests/helpers/migrator.ts prepends a
    // migration that is not in migrations/ and must never reach the image.
    const message = checkCompiledSet([HARNESS_BOOTSTRAP, ...MIGRATION_MANIFEST]);

    expect(message).not.toBeNull();
    expect(message).toContain(HARNESS_BOOTSTRAP);
    expect(message).toContain("Compiled but not in the manifest (1)");
  });

  it("rejects a compiled set that is missing a migration", () => {
    const message = checkCompiledSet(MIGRATION_MANIFEST.slice(0, -1));

    expect(message).not.toBeNull();
    expect(message).toContain("In the manifest but not compiled (1)");
    expect(message).toContain(MIGRATION_MANIFEST[MIGRATION_MANIFEST.length - 1]);
  });
});

describe("runMigrations", () => {
  it("refuses to touch the database when the compiled set is wrong", async () => {
    // Applying a bogus set and only then failing would leave a database the
    // startup check rejects and that nothing can migrate forward.
    const migrations: Record<string, Migration> = {
      [HARNESS_BOOTSTRAP]: noopMigration,
    };
    for (const name of MIGRATION_MANIFEST) {
      migrations[name] = noopMigration;
    }
    const { io, error } = capturingIo();

    const code = await runMigrations(unusableDb(), migrations, io);

    expect(code).toBe(1);
    expect(error.join("\n")).toContain(HARNESS_BOOTSTRAP);
  });
});

describe("describeConnection", () => {
  it("names the database and host", () => {
    expect(
      describeConnection("postgresql://u:p@db.example.com:5432/forecasting"),
    ).toBe("forecasting on db.example.com:5432");
  });

  it("never leaks the credentials", () => {
    const described = describeConnection(
      "postgresql://someuser:hunter2@db.example.com/forecasting",
    );

    expect(described).not.toContain("hunter2");
    expect(described).not.toContain("someuser");
  });

  it("does not throw on an unparseable value", () => {
    expect(describeConnection("not a url")).toBe("(unparseable DATABASE_URL)");
  });
});

describe("runMigrationCli", () => {
  it("refuses Neon's pooled host, which cannot hold the migration lock", async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      "postgresql://owner:secret@ep-quiet-sky-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
    const { io, error } = capturingIo();

    try {
      expect(await runMigrationCli({}, io)).toBe(1);
      const message = error.join("\n");
      expect(message).toContain("-pooler");
      expect(message).toContain("direct");
      expect(message).not.toContain("secret");
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  it("fails without connecting when DATABASE_URL is unset", async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const { io, error } = capturingIo();

    try {
      expect(await runMigrationCli({}, io)).toBe(1);
      expect(error.join("\n")).toContain("DATABASE_URL is not set");
    } finally {
      if (previous !== undefined) {
        process.env.DATABASE_URL = previous;
      }
    }
  });
});

describe("the entry point the build generates", () => {
  it("imports every migration, and each exactly once", () => {
    const entry = renderEntry(["a", "b"]);

    expect(entry).toContain('import * as m0 from "./migrations/a.ts";');
    expect(entry).toContain('import * as m1 from "./migrations/b.ts";');
    expect(entry.match(/^import \* as m/gm)).toHaveLength(2);
    expect(entry).toContain("process.exit(await runMigrationCli(MIGRATIONS));");
  });

  it("only ever reaches into migrations/", () => {
    expect(renderEntry([...MIGRATION_MANIFEST])).not.toContain("tests/");
  });
});

describe("assertMatchesManifest", () => {
  it("passes for the real migrations directory", () => {
    expect(() => assertMatchesManifest(MIGRATION_MANIFEST)).not.toThrow();
  });

  it("fails the build when the compiled set gains a migration", () => {
    expect(() =>
      assertMatchesManifest([HARNESS_BOOTSTRAP, ...MIGRATION_MANIFEST]),
    ).toThrow(HARNESS_BOOTSTRAP);
  });

  it("fails the build when the compiled set loses a migration", () => {
    expect(() => assertMatchesManifest(MIGRATION_MANIFEST.slice(1))).toThrow(
      MIGRATION_MANIFEST[0],
    );
  });
});

describe("the compiled migration runner", () => {
  let artifact: RunnerArtifact;
  let bundle: string;

  beforeAll(async () => {
    artifact = await buildRunnerArtifact();
    bundle = await fs.readFile(artifact.outFile, "utf8");
  }, 120000);

  afterAll(async () => {
    await artifact.cleanup();
  });

  it("declares its own module format instead of inheriting one", async () => {
    // The bundle lands beside whatever package.json Next's standalone output
    // happens to write. It states its own type rather than depending on that.
    const manifest = JSON.parse(
      await fs.readFile(path.join(artifact.outDir, "package.json"), "utf8"),
    );

    expect(manifest.type).toBe("module");
  });

  it("contains the real migrations", () => {
    // A marker from the newest migration, so the absence assertions below
    // cannot pass against an empty or stale bundle.
    expect(bundle).toContain(
      "at_least_one_of_user_id_category_id_competition_id",
    );
  });

  it("does not contain the test harness's bootstrap migration", () => {
    // Seed rows unique to tests/helpers/000000000000_create-initial-schema.ts
    // — nothing in migrations/ contains them. If that file were ever swept into
    // the bundle, they would appear.
    expect(bundle).not.toContain("admin@system.local");
    expect(bundle).not.toContain("System Admin");
    expect(bundle).not.toContain(HARNESS_BOOTSTRAP);
  });

  it("resolves nothing from node_modules at runtime", () => {
    // The image's node_modules comes from Next's standalone file tracing, which
    // does not emit kysely today and is free to change what it emits tomorrow.
    // So the bundle may reach for node builtins and nothing else — except
    // pg-native, an optional binding pg requires behind a lazy try/catch that
    // this runner never triggers.
    const imported = [
      ...bundle.matchAll(/^import\b[^\n]*?from\s+["']([^"']+)["'];?$/gm),
    ].map((match) => match[1]);
    const required = [
      ...new Set(
        [...bundle.matchAll(/require\(["']([^"']+)["']\)/g)].map(
          (match) => match[1],
        ),
      ),
    ];

    expect(imported.filter((id) => !isBuiltin(id))).toEqual([]);
    expect(required.filter((id) => !isBuiltin(id))).toEqual(["pg-native"]);
  });

  it("really did inline kysely and pg", () => {
    // Otherwise the assertion above would pass on a bundle that simply has no
    // database driver in it at all.
    expect(bundle).toContain("PostgresDialect");
    expect(bundle).toContain("node_modules/kysely/");
    expect(bundle).toContain("node_modules/pg/");
  });

  it("runs under plain node and exits non-zero without a database", async () => {
    // The artifact contract: a real `node <something>.js` that never exits 0
    // without having migrated.
    const result = await runArtifact(artifact.outFile);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL is not set");
  }, 60000);
});
