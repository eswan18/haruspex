import { describe, expect, it } from "vitest";
import { classifyBump } from "../../.github/guard/bump";

type Versions = Record<string, string>;

const pkg = (deps: Versions, dev: Versions = {}, extra: object = {}) =>
  JSON.stringify({
    name: "haruspex",
    scripts: { test: "vitest run" },
    dependencies: deps,
    devDependencies: dev,
    ...extra,
  });

/** A lockfile where each named package is installed at the given version. */
const lock = (installed: Versions) =>
  JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "haruspex" },
      ...Object.fromEntries(
        Object.entries(installed).map(([name, version]) => [
          `node_modules/${name}`,
          { version },
        ]),
      ),
    },
  });

function classify(
  before: { deps: Versions; installed: Versions },
  after: { deps: Versions; installed: Versions },
) {
  return classifyBump({
    basePackageJson: pkg(before.deps),
    headPackageJson: pkg(after.deps),
    baseLock: lock(before.installed),
    headLock: lock(after.installed),
  });
}

describe("classifyBump", () => {
  it("accepts patch and minor updates to direct dependencies", () => {
    const result = classify(
      { deps: { next: "^16.1.0", zod: "^4.0.0" }, installed: { next: "16.1.0", zod: "4.0.0" } },
      { deps: { next: "^16.2.0", zod: "^4.0.0" }, installed: { next: "16.2.3", zod: "4.0.1" } },
    );
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.changes).toEqual([
      { name: "next", from: "16.1.0", to: "16.2.3", level: "minor" },
      { name: "zod", from: "4.0.0", to: "4.0.1", level: "patch" },
    ]);
  });

  it("accepts a lockfile-only change to a direct dependency", () => {
    const result = classify(
      { deps: { zod: "^4.0.0" }, installed: { zod: "4.0.0" } },
      { deps: { zod: "^4.0.0" }, installed: { zod: "4.1.0" } },
    );
    expect(result.eligible).toBe(true);
  });

  it("accepts a change that only moves indirect dependencies", () => {
    const result = classify(
      { deps: { zod: "^4.0.0" }, installed: { zod: "4.0.0", "tiny-dep": "1.0.0" } },
      { deps: { zod: "^4.0.0" }, installed: { zod: "4.0.0", "tiny-dep": "2.0.0" } },
    );
    expect(result.eligible).toBe(true);
    expect(result.changes).toEqual([]);
  });

  it("refuses a major update", () => {
    const result = classify(
      { deps: { typescript: "^6.0.3" }, installed: { typescript: "6.0.3" } },
      { deps: { typescript: "^7.0.2" }, installed: { typescript: "7.0.2" } },
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(["typescript: 6.0.3 to 7.0.2 is a major update"]);
  });

  it("treats a 0.x minor update as major, as semver does", () => {
    const result = classify(
      { deps: { early: "^0.4.1" }, installed: { early: "0.4.1" } },
      { deps: { early: "^0.5.0" }, installed: { early: "0.5.0" } },
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain("major");
  });

  it("accepts a 0.x patch update", () => {
    const result = classify(
      { deps: { early: "^0.4.1" }, installed: { early: "0.4.1" } },
      { deps: { early: "^0.4.2" }, installed: { early: "0.4.2" } },
    );
    expect(result.eligible).toBe(true);
  });

  it("refuses a downgrade", () => {
    const result = classify(
      { deps: { zod: "^4.1.0" }, installed: { zod: "4.1.0" } },
      { deps: { zod: "^4.0.0" }, installed: { zod: "4.0.9" } },
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain("downgrade");
  });

  it("refuses a pre-release or otherwise unusual version", () => {
    const result = classify(
      { deps: { zod: "^4.0.0" }, installed: { zod: "4.0.0" } },
      { deps: { zod: "^4.1.0" }, installed: { zod: "4.1.0-beta.1" } },
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain("4.1.0-beta.1");
  });

  it("refuses an added or removed direct dependency", () => {
    const added = classify(
      { deps: { zod: "^4.0.0" }, installed: { zod: "4.0.0" } },
      { deps: { zod: "^4.0.0", extra: "^1.0.0" }, installed: { zod: "4.0.0", extra: "1.0.0" } },
    );
    expect(added.eligible).toBe(false);
    expect(added.reasons).toEqual(["extra: added as a direct dependency"]);

    const removed = classify(
      { deps: { zod: "^4.0.0", gone: "^1.0.0" }, installed: { zod: "4.0.0", gone: "1.0.0" } },
      { deps: { zod: "^4.0.0" }, installed: { zod: "4.0.0" } },
    );
    expect(removed.eligible).toBe(false);
    expect(removed.reasons).toEqual(["gone: removed as a direct dependency"]);
  });

  it("refuses a dependency that is not pulled from the registry by version", () => {
    const result = classify(
      { deps: { zod: "^4.0.0" }, installed: { zod: "4.0.0" } },
      { deps: { zod: "github:someone/zod" }, installed: { zod: "4.0.1" } },
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain("github:someone/zod");
  });

  it("refuses when package.json changes outside its dependency sections", () => {
    const result = classifyBump({
      basePackageJson: pkg({ zod: "^4.0.0" }),
      headPackageJson: pkg({ zod: "^4.0.0" }, {}, { scripts: { test: "true" } }),
      baseLock: lock({ zod: "4.0.0" }),
      headLock: lock({ zod: "4.0.0" }),
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain("scripts");
  });

  it("refuses when a direct dependency is missing from the lockfile", () => {
    const result = classify(
      { deps: { zod: "^4.0.0" }, installed: { zod: "4.0.0" } },
      { deps: { zod: "^4.0.0" }, installed: {} },
    );
    expect(result.eligible).toBe(false);
  });

  it("refuses files it cannot read, instead of throwing", () => {
    const result = classifyBump({
      basePackageJson: "not json",
      headPackageJson: pkg({}),
      baseLock: lock({}),
      headLock: "{}",
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("checks dev and optional dependencies too", () => {
    const result = classifyBump({
      basePackageJson: pkg({}, { vitest: "^5.0.0" }),
      headPackageJson: pkg({}, { vitest: "^6.0.0" }),
      baseLock: lock({ vitest: "5.1.0" }),
      headLock: lock({ vitest: "6.0.0" }),
    });
    expect(result.eligible).toBe(false);
  });
});
