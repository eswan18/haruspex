/**
 * The Guard check's rules: what a bot's pull request may change.
 *
 * Pure functions, no I/O, so they can be unit-tested (tests/guard) and run
 * directly by Node in the workflow (.github/workflows/guard.yml). Keep the
 * syntax erasable: Node strips the types, it does not compile them.
 *
 * The rules are an allowlist. Anything not named here is blocked, so a new
 * top-level directory or config file is protected by default.
 */

export const LIMITS = { maxFiles: 25, maxLines: 800 } as const;

/** Directories of application source a bot may edit. */
const ALLOWED_DIRS = ["app/", "components/", "lib/", "hooks/", "types/"];

/** Individual root files a bot may edit. */
const ALLOWED_FILES = ["proxy.ts"];

/** Carved out of the allowed directories. */
const BLOCKED_DIRS = [
  // The check that stops a deploy when the schema and the code disagree.
  "lib/migrations/",
];

/** Dependency manifests, which only the bump bot's PRs may change. */
const PACKAGE_JSON = "package.json";
const LOCKFILE = "package-lock.json";

/** The parts of package.json a dependency bump is allowed to change. */
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
];

const BUMP_BOT_LOGINS = ["dependabot[bot]"];

export type AuthorKind = "human" | "bump-bot" | "agent";

export interface Author {
  login: string;
  /** GitHub's account type: "User", "Bot" or "Organization". */
  type: string;
}

/** One entry from GitHub's "list pull request files" API. */
export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  previous_filename?: string;
}

export interface GuardInput {
  author: Author;
  files: ChangedFile[];
  /**
   * Everyone else with a hand in the PR: each commit's author and committer,
   * and whoever triggered this run. `null` is someone GitHub could not match
   * to an account, which is treated as not a person.
   */
  contributors?: (Author | null)[];
  /** True when the file list may be incomplete (API cap reached). */
  truncated?: boolean;
  /** package.json at the base and head commits, when the PR changes it. */
  packageJson?: { base: string; head: string };
  /**
   * True for an agent's PR written from an issue (issue.ts). It lets the
   * agent add new test files. It never lets it edit, rename or delete one
   * that already exists.
   */
  allowNewTests?: boolean;
}

export interface GuardResult {
  kind: AuthorKind;
  violations: string[];
}

/**
 * Who opened the PR. The account type decides, not the login: GitHub sets the
 * type, and only an App can be a "Bot".
 */
export function classifyAuthor(author: Author): AuthorKind {
  if (author.type !== "Bot") return "human";
  return BUMP_BOT_LOGINS.includes(author.login) ? "bump-bot" : "agent";
}

/** Directory names that hold tests or the data and stand-ins they run on. */
const TEST_DIRS = [
  "__tests__",
  "__mocks__",
  "__fixtures__",
  "mocks",
  "fixtures",
  "testing",
  "test-utils",
];

/**
 * Tests, and the fixtures and mocks tests are built on. Editing a fixture can
 * change what a test proves just as surely as editing the test.
 */
function isTestFile(path: string): boolean {
  const segments = path.split("/");
  const name = segments[segments.length - 1];
  return (
    segments.slice(0, -1).some((dir) => TEST_DIRS.includes(dir)) ||
    /\.(test|spec|mock|mocks|fixture|fixtures)\.[^/]+$/.test(name) ||
    /^(fixtures?|mocks?|test-utils)\.[^/]+$/.test(name)
  );
}

/** The only kinds of file application source is made of here. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".css"];

/** Dot-directories that are part of the app's URL space, not tooling. */
const ALLOWED_DOT_DIRS = [".well-known"];

/**
 * A file of the kinds the app is written in, somewhere a bot may write.
 * Says nothing about whether it is a test; see isSourceFile and isNewTestPath.
 */
function isAppPath(path: string): boolean {
  // Refuse anything that is not a plain repo-relative path before matching
  // prefixes, so "app/../.github/x" cannot ride in on "app/".
  if (path.startsWith("/") || path.split("/").includes("..")) return false;
  // Being inside an allowed directory is not enough. Dotfiles and anything
  // that is not source would let a bot plant tooling config or instructions
  // for a later agent run: lib/.gitattributes, app/CLAUDE.md, app/package.json.
  const hidden = path
    .split("/")
    .some((part) => part.startsWith(".") && !ALLOWED_DOT_DIRS.includes(part));
  if (hidden) return false;
  // A nested node_modules would be picked up ahead of the real package by
  // anything importing from beside it: a dependency change by another name.
  if (path.split("/").includes("node_modules")) return false;
  if (!SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  // Tool configuration is not source, whatever directory it sits in. Some
  // tools look for theirs beside the file they are processing.
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (/\.(config|workspace|setup)\.[^.]+$/.test(name)) return false;
  if (BLOCKED_DIRS.some((dir) => path.startsWith(dir))) return false;
  return (
    ALLOWED_FILES.includes(path) ||
    ALLOWED_DIRS.some((dir) => path.startsWith(dir))
  );
}

function isSourceFile(path: string): boolean {
  return isAppPath(path) && !isTestFile(path);
}

/**
 * Where an agent may put a test it writes: beside the code, named *.test.ts
 * or *.spec.ts (or .tsx). Fixtures, mocks and shared test helpers stay out of
 * reach, because other tests are built on them.
 */
function isNewTestPath(path: string): boolean {
  if (!isAppPath(path)) return false;
  const segments = path.split("/");
  if (segments.slice(0, -1).some((dir) => TEST_DIRS.includes(dir))) {
    return false;
  }
  return /\.(test|spec)\.tsx?$/.test(segments[segments.length - 1]);
}

function isAllowed(
  file: ChangedFile,
  path: string,
  kind: AuthorKind,
  allowNewTests: boolean,
): boolean {
  if (kind === "bump-bot" && (path === PACKAGE_JSON || path === LOCKFILE)) {
    return true;
  }
  if (isSourceFile(path)) return true;
  // "added" is the one status that cannot change or remove an existing test.
  return (
    allowNewTests &&
    kind === "agent" &&
    file.status === "added" &&
    file.previous_filename === undefined &&
    isNewTestPath(path)
  );
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Stable serialisation, so key order does not count as a change. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * A bump may change which packages are installed and nothing else. Without
 * this, a PR could rewrite the "test" script to a no-op and pass every check.
 */
export function packageJsonViolations(
  baseText: string,
  headText: string,
): string[] {
  const base = parseObject(baseText);
  const head = parseObject(headText);
  if (!base || !head) {
    return [`${PACKAGE_JSON}: could not be read as a JSON object`];
  }

  const keys = new Set([...Object.keys(base), ...Object.keys(head)]);
  const changed = [...keys]
    .filter((key) => !DEPENDENCY_SECTIONS.includes(key))
    .filter((key) => canonical(base[key]) !== canonical(head[key]))
    .sort();

  return changed.map(
    (key) =>
      `${PACKAGE_JSON}: "${key}" changed; a bot may only change dependency sections`,
  );
}

/**
 * Which rules apply to the whole PR. Who opened it is not enough: a bot with
 * write access can push to a branch a person opened, so a person's PR counts
 * as a person's only when every contributor is one.
 *
 * A bump bot's PR keeps the bump rules when an agent adds a fix to it; that is
 * the dependency workflow. A person's PR never gains the bump allowance.
 */
function classifyPullRequest(input: GuardInput): AuthorKind {
  const opener = classifyAuthor(input.author);
  if (opener !== "human") return opener;
  const allPeople = (input.contributors ?? []).every(
    (contributor) =>
      contributor !== null && classifyAuthor(contributor) === "human",
  );
  return allPeople ? "human" : "agent";
}

export function evaluate(input: GuardInput): GuardResult {
  const kind = classifyPullRequest(input);
  if (kind === "human") return { kind, violations: [] };

  const violations: string[] = [];

  if (input.truncated) {
    violations.push(
      "The list of changed files may not be complete, so the diff cannot be checked",
    );
  }

  for (const file of input.files) {
    // A rename touches two paths; both must be allowed, or a test could be
    // "renamed" out of existence.
    const paths = [file.filename, file.previous_filename].filter(
      (path): path is string => path !== undefined,
    );
    for (const path of paths) {
      if (!isAllowed(file, path, kind, input.allowNewTests === true)) {
        violations.push(`${path || "(empty path)"}: outside what a bot may change`);
      }
    }
  }

  const counted = input.files.filter((file) => file.filename !== LOCKFILE);
  if (counted.length > LIMITS.maxFiles) {
    violations.push(
      `${counted.length} files changed; the limit is ${LIMITS.maxFiles}`,
    );
  }
  const lines = counted.reduce(
    (sum, file) => sum + file.additions + file.deletions,
    0,
  );
  if (lines > LIMITS.maxLines) {
    violations.push(`${lines} lines changed; the limit is ${LIMITS.maxLines}`);
  }

  if (
    kind === "bump-bot" &&
    input.files.some(
      (file) =>
        file.filename === PACKAGE_JSON || file.previous_filename === PACKAGE_JSON,
    )
  ) {
    violations.push(
      ...(input.packageJson
        ? packageJsonViolations(input.packageJson.base, input.packageJson.head)
        : [`${PACKAGE_JSON}: changed, but its contents could not be compared`]),
    );
  }

  return { kind, violations };
}
