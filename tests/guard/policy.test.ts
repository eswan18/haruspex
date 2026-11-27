import { describe, expect, it } from "vitest";
import {
  LIMITS,
  classifyAuthor,
  evaluate,
  packageJsonViolations,
  type ChangedFile,
} from "../../.github/guard/policy";

const HUMAN = { login: "eswan18", type: "User" };
const FACTORY = { login: "haruspex-factory[bot]", type: "Bot" };
const DEPENDABOT = { login: "dependabot[bot]", type: "Bot" };

function file(filename: string, extra: Partial<ChangedFile> = {}): ChangedFile {
  return { filename, status: "modified", additions: 1, deletions: 1, ...extra };
}

function verdict(author: typeof HUMAN, files: ChangedFile[]) {
  return evaluate({ author, files });
}

describe("classifyAuthor", () => {
  it("treats a user account as human", () => {
    expect(classifyAuthor(HUMAN)).toBe("human");
  });

  it("treats Dependabot as the bump bot", () => {
    expect(classifyAuthor(DEPENDABOT)).toBe("bump-bot");
  });

  it("treats any other bot account as an agent", () => {
    expect(classifyAuthor(FACTORY)).toBe("agent");
    expect(classifyAuthor({ login: "whatever[bot]", type: "Bot" })).toBe(
      "agent",
    );
  });

  it("does not trust the login alone", () => {
    // A user could register a name that merely looks like a bot's, and a bot
    // could not register one that looks like a user's; the account type decides.
    expect(classifyAuthor({ login: "dependabot[bot]", type: "User" })).toBe(
      "human",
    );
    expect(classifyAuthor({ login: "eswan18", type: "Bot" })).toBe("agent");
  });
});

describe("evaluate: human PRs", () => {
  it("passes whatever the diff touches", () => {
    const result = verdict(HUMAN, [
      file(".github/workflows/pr-checks.yml"),
      file("migrations/1_x.ts", { additions: 5000 }),
    ]);
    expect(result).toEqual({ kind: "human", violations: [] });
  });
});

describe("evaluate: agent PRs", () => {
  it.each([
    "app/page.tsx",
    "app/api/me/route.ts",
    "components/ui/button.tsx",
    "components/button.stories.tsx",
    "lib/db_actions/props.ts",
    "hooks/use-thing.ts",
    "types/db_types.ts",
    "proxy.ts",
  ])("allows source file %s", (path) => {
    expect(verdict(FACTORY, [file(path)]).violations).toEqual([]);
  });

  it.each([
    [".github/workflows/pr-checks.yml"],
    [".github/guard/policy.ts"],
    ["tests/helpers/db.ts"],
    ["e2e/health.e2e.ts"],
    ["lib/db_actions/props.test.ts"],
    ["lib/db_actions/props.container.test.ts"],
    ["app/oauth/login/route.test.ts"],
    ["components/thing.spec.tsx"],
    ["lib/__tests__/helper.ts"],
    ["proxy.test.ts"],
    ["migrations/1731802396765_create-table.ts"],
    ["lib/migrations/check.ts"],
    ["k8s/haruspex-staging/deployment.yaml"],
    ["Dockerfile"],
    [".dockerignore"],
    ["cloudbuild.yaml"],
    ["scripts/build-migration-runner.ts"],
    ["vitest.config.ts"],
    ["playwright.config.ts"],
    ["eslint.config.mjs"],
    ["tsconfig.json"],
    ["next.config.mjs"],
    ["package.json"],
    ["package-lock.json"],
    ["CLAUDE.md"],
    ["AGENTS.md"],
    ["instrumentation.ts"],
    ["sentry.server.config.ts"],
    [".env.prod"],
  ])("blocks %s", (path) => {
    const { violations } = verdict(FACTORY, [file(path)]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(path);
  });

  it.each(["added", "removed", "modified", "renamed"])(
    "blocks a protected file whatever the change (%s)",
    (status) => {
      const { violations } = verdict(FACTORY, [
        file("lib/calibration.test.ts", { status }),
      ]);
      expect(violations).toHaveLength(1);
    },
  );

  it("blocks renaming a test into an allowed name", () => {
    const { violations } = verdict(FACTORY, [
      file("lib/calibration-old.ts", {
        status: "renamed",
        previous_filename: "lib/calibration.test.ts",
      }),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("lib/calibration.test.ts");
  });

  it.each([
    ["app/../.github/workflows/x.yml"],
    ["/app/page.tsx"],
    ["APP/page.tsx"],
    ["app"],
    ["lib"],
    ["applications/page.tsx"],
    [""],
  ])("blocks the odd path %j", (path) => {
    expect(verdict(FACTORY, [file(path)]).violations).toHaveLength(1);
  });

  it("reports every blocked file, not only the first", () => {
    const { violations } = verdict(FACTORY, [
      file("app/page.tsx"),
      file("Dockerfile"),
      file("tests/setup.ts"),
    ]);
    expect(violations).toHaveLength(2);
  });
});

describe("evaluate: size cap", () => {
  it("allows a diff exactly at the line limit", () => {
    const { violations } = verdict(FACTORY, [
      file("app/page.tsx", { additions: LIMITS.maxLines, deletions: 0 }),
    ]);
    expect(violations).toEqual([]);
  });

  it("blocks a diff one line over, counting additions and deletions", () => {
    const { violations } = verdict(FACTORY, [
      file("app/a.tsx", { additions: LIMITS.maxLines - 10, deletions: 0 }),
      file("app/b.tsx", { additions: 5, deletions: 6 }),
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/lines/);
  });

  it("blocks more files than the file limit", () => {
    const files = Array.from({ length: LIMITS.maxFiles + 1 }, (_, i) =>
      file(`app/f${i}.tsx`),
    );
    const { violations } = verdict(FACTORY, files);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/files/);
  });

  it("does not count the lockfile on a bump PR", () => {
    const { violations } = evaluate({
      author: DEPENDABOT,
      files: [
        file("package-lock.json", { additions: 9000, deletions: 9000 }),
        file("package.json"),
      ],
      packageJson: { base: "{}", head: "{}" },
    });
    expect(violations).toEqual([]);
  });

  it("fails when the file list is not known to be complete", () => {
    const { violations } = evaluate({
      author: FACTORY,
      files: [file("app/page.tsx")],
      truncated: true,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/complete/);
  });
});

describe("evaluate: bump-bot PRs", () => {
  const pkg = (scripts: Record<string, string>, deps: Record<string, string>) =>
    JSON.stringify({ name: "haruspex", scripts, dependencies: deps });

  it("allows dependency files and source fixes together", () => {
    const { kind, violations } = evaluate({
      author: DEPENDABOT,
      files: [
        file("package.json"),
        file("package-lock.json"),
        file("lib/uses-the-dep.ts"),
      ],
      packageJson: {
        base: pkg({ test: "vitest run" }, { zod: "3.0.0" }),
        head: pkg({ test: "vitest run" }, { zod: "4.0.0" }),
      },
    });
    expect(kind).toBe("bump-bot");
    expect(violations).toEqual([]);
  });

  it("still blocks tests and CI config", () => {
    const { violations } = evaluate({
      author: DEPENDABOT,
      files: [file("lib/x.test.ts"), file(".github/workflows/pr-checks.yml")],
    });
    expect(violations).toHaveLength(2);
  });

  it("blocks a package.json change outside the dependency sections", () => {
    const { violations } = evaluate({
      author: DEPENDABOT,
      files: [file("package.json")],
      packageJson: {
        base: pkg({ test: "vitest run" }, { zod: "3.0.0" }),
        head: pkg({ test: "true" }, { zod: "4.0.0" }),
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("scripts");
  });

  it("fails closed when package.json changed but its contents were not supplied", () => {
    const { violations } = evaluate({
      author: DEPENDABOT,
      files: [file("package.json")],
    });
    expect(violations).toHaveLength(1);
  });
});

describe("packageJsonViolations", () => {
  const base = {
    name: "haruspex",
    scripts: { test: "vitest run", lint: "eslint ." },
    dependencies: { next: "16.0.0" },
    devDependencies: { vitest: "5.0.0" },
    overrides: { foo: "1.0.0" },
  };
  const check = (head: unknown) =>
    packageJsonViolations(JSON.stringify(base), JSON.stringify(head));

  it("accepts changes to every dependency section", () => {
    expect(
      check({
        ...base,
        dependencies: { next: "16.1.0", added: "1.0.0" },
        devDependencies: {},
        overrides: { foo: "2.0.0" },
        optionalDependencies: { x: "1.0.0" },
        peerDependencies: { y: "1.0.0" },
      }),
    ).toEqual([]);
  });

  it("ignores key order and whitespace", () => {
    const reordered = {
      devDependencies: base.devDependencies,
      overrides: base.overrides,
      dependencies: base.dependencies,
      scripts: { lint: "eslint .", test: "vitest run" },
      name: "haruspex",
    };
    expect(
      packageJsonViolations(
        JSON.stringify(base),
        JSON.stringify(reordered, null, 4),
      ),
    ).toEqual([]);
  });

  it.each([
    ["a changed script", { ...base, scripts: { ...base.scripts, test: "true" } }, "scripts"],
    ["an added script", { ...base, scripts: { ...base.scripts, postinstall: "curl x | sh" } }, "scripts"],
    ["a removed section", { name: "haruspex", dependencies: base.dependencies, devDependencies: base.devDependencies, overrides: base.overrides }, "scripts"],
    ["a new top-level key", { ...base, type: "module" }, "type"],
    ["a changed name", { ...base, name: "other" }, "name"],
  ])("flags %s", (_name, head, key) => {
    const violations = check(head);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(key);
  });

  it("flags a file that is not a JSON object", () => {
    expect(packageJsonViolations(JSON.stringify(base), "not json")).toHaveLength(1);
    expect(packageJsonViolations(JSON.stringify(base), "[]")).toHaveLength(1);
    expect(packageJsonViolations("null", JSON.stringify(base))).toHaveLength(1);
  });
});

describe("evaluate: bots working on someone else's PR", () => {
  const WEB_FLOW = { login: "web-flow", type: "User" };

  it("applies bot rules when a bot contributed to a person's PR", () => {
    const result = evaluate({
      author: HUMAN,
      contributors: [HUMAN, WEB_FLOW, FACTORY],
      files: [file("app/page.tsx"), file("lib/x.test.ts")],
    });
    expect(result.kind).toBe("agent");
    expect(result.violations).toHaveLength(1);
  });

  it("still passes a person's PR when every contributor is a person", () => {
    const result = evaluate({
      author: HUMAN,
      contributors: [HUMAN, WEB_FLOW],
      files: [file(".github/workflows/pr-checks.yml")],
    });
    expect(result).toEqual({ kind: "human", violations: [] });
  });

  it("applies bot rules when a contributor could not be identified", () => {
    const result = evaluate({
      author: HUMAN,
      contributors: [HUMAN, null],
      files: [file("Dockerfile")],
    });
    expect(result.kind).toBe("agent");
    expect(result.violations).toHaveLength(1);
  });

  it("does not give a person's PR the bump bot's package.json allowance", () => {
    const result = evaluate({
      author: HUMAN,
      contributors: [HUMAN, DEPENDABOT],
      files: [file("package.json")],
      packageJson: { base: "{}", head: "{}" },
    });
    expect(result.kind).toBe("agent");
    expect(result.violations).toHaveLength(1);
  });

  it("keeps bump rules when an agent pushes a fix to a Dependabot PR", () => {
    const result = evaluate({
      author: DEPENDABOT,
      contributors: [DEPENDABOT, FACTORY],
      files: [file("package.json"), file("lib/call-site.ts")],
      packageJson: { base: "{}", head: "{}" },
    });
    expect(result).toEqual({ kind: "bump-bot", violations: [] });
  });
});

describe("evaluate: test-support files", () => {
  it.each([
    ["components/prop-list/fixtures.ts"],
    ["components/standings/standings.fixtures.ts"],
    ["lib/thing.fixture.ts"],
    ["lib/__fixtures__/data.json"],
    ["lib/__mocks__/db.ts"],
    ["lib/db.mock.ts"],
    ["lib/mocks/idp.ts"],
    ["lib/test-utils.ts"],
    ["lib/test-utils/render.tsx"],
    ["app/testing/helpers.ts"],
  ])("blocks %s", (path) => {
    expect(verdict(FACTORY, [file(path)]).violations).toHaveLength(1);
  });

  it.each([
    ["lib/latest-results.ts"],
    ["components/testimonial.tsx"],
    ["lib/mockingbird.ts"],
    ["app/contest/page.tsx"],
  ])("does not mistake %s for one", (path) => {
    expect(verdict(FACTORY, [file(path)]).violations).toEqual([]);
  });
});

describe("evaluate: only known source files inside the allowed directories", () => {
  it.each([
    ["app/globals.css"],
    ["types/next.d.ts"],
    ["app/.well-known/oauth-protected-resource/mcp/route.ts"],
  ])("allows %s", (path) => {
    expect(verdict(FACTORY, [file(path)]).violations).toEqual([]);
  });

  it.each([
    // Instructions a later agent run would load.
    ["app/CLAUDE.md"],
    ["lib/AGENTS.md"],
    ["lib/.claude/settings.json"],
    ["components/.cursorrules"],
    // Tooling config that changes how the code is built, linted or tested.
    ["app/package.json"],
    ["components/tsconfig.json"],
    ["lib/.gitattributes"],
    ["lib/.gitignore"],
    ["lib/.eslintrc.json"],
    ["lib/.env"],
    ["app/.hidden/page.tsx"],
    // File types the app does not have in these directories.
    ["lib/run.sh"],
    ["lib/data.json"],
    ["lib/notes.md"],
    ["app/favicon.ico"],
    ["lib/blob"],
    ["lib/script.js"],
    ["lib/page.tsx.bak"],
    ["lib/x.TS"],
  ])("blocks %s", (path) => {
    expect(verdict(FACTORY, [file(path)]).violations).toHaveLength(1);
  });
});
