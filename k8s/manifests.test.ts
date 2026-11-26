import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * Deploys migrate their database in an initContainer, as the database's owner
 * role, before the app starts. These pin what a copy-paste or a rename could
 * quietly break: the initContainer must run this build's own migrations (the
 * app's image), each environment must read its own owner credential, and the
 * app container must never be handed that credential.
 */

const K8S = path.join(process.cwd(), "k8s");
const ENVS = ["staging", "prod"] as const;
const RUNNER = ["node", "/app/migrate/index.js"];

type Doc = any;

const load = (...parts: string[]): Doc =>
  parse(readFileSync(path.join(K8S, ...parts), "utf8"));

const named = (list: Doc[] | undefined, name: string): Doc =>
  (list ?? []).find((item) => item.name === name);

const base = load("haruspex-base", "deployment.yaml");
const baseSpec = base.spec.template.spec;
const baseApp = named(baseSpec.containers, "haruspex");
const baseMigrate = named(baseSpec.initContainers, "migrate");

describe("the migrate initContainer", () => {
  it("runs this build's runner, with the app's image", () => {
    expect(baseSpec.initContainers).toHaveLength(1);
    expect(baseMigrate).toBeDefined();
    // Byte-identical, so ArgoCD's kustomize image override replaces both.
    expect(baseMigrate.image).toBe(baseApp.image);
    expect(baseMigrate.command).toEqual(RUNNER);
    expect(baseMigrate.securityContext).toEqual(baseApp.securityContext);
    expect(named(baseMigrate.volumeMounts, "migrate-secrets")).toEqual({
      name: "migrate-secrets",
      mountPath: "/mnt/migrate",
      readOnly: true,
    });
  });
});

describe.each(ENVS)("%s", (env) => {
  const secret = `haruspex-${env}-migrate-secrets`;
  const patch = load(`haruspex-${env}`, "deployment-patch.yaml");
  const patchSpec = patch.spec.template.spec;

  it("gives the initContainer its own environment's owner credential", () => {
    const migrate = named(patchSpec.initContainers, "migrate");
    expect(named(migrate.env, "DATABASE_URL")).toEqual({
      name: "DATABASE_URL",
      valueFrom: { secretKeyRef: { name: secret, key: "DATABASE_URL" } },
    });
    expect(named(patchSpec.volumes, "migrate-secrets").csi).toEqual({
      driver: "secrets-store.csi.k8s.io",
      readOnly: true,
      volumeAttributes: { secretProviderClass: secret },
    });

    const spc = load(`haruspex-${env}`, "secret-provider-class-migrate.yaml");
    expect(spc.metadata).toEqual({
      name: secret,
      namespace: `haruspex-${env}`,
    });
    expect(parse(spc.spec.parameters.secrets)).toEqual([
      {
        resourceName: `projects/ethans-services/secrets/haruspex_${env}_migrate_database_url/versions/latest`,
        path: "DATABASE_URL",
      },
    ]);
    expect(spc.spec.secretObjects).toEqual([
      {
        secretName: secret,
        type: "Opaque",
        data: [{ objectName: "DATABASE_URL", key: "DATABASE_URL" }],
      },
    ]);

    const kustomization = load(`haruspex-${env}`, "kustomization.yaml");
    expect(kustomization.resources).toContain(
      "secret-provider-class-migrate.yaml",
    );
  });

  it("never hands the owner credential to the app container", () => {
    for (const app of [baseApp, named(patchSpec.containers, "haruspex")]) {
      const text = JSON.stringify(app);
      expect(text).not.toContain("migrate-secrets");
      expect(text).not.toContain("migrate_database_url");
    }
    // The app's own SecretProviderClass is mounted at /mnt/secrets in the app
    // container, so the owner credential must not be one of its objects.
    const appSpc = readFileSync(
      path.join(K8S, `haruspex-${env}`, "secret-provider-class.yaml"),
      "utf8",
    );
    expect(appSpc).not.toContain("migrate_database_url");
  });
});
