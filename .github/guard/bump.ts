/**
 * Decides whether a dependency bump is the kind that may merge without a
 * person: minor and patch updates only.
 *
 * It does not take Dependabot's word for what a pull request contains. It
 * compares the package.json and lockfile before and after, so the answer comes
 * from what would actually be installed. Pure functions; classify-bump.ts is
 * the command-line wrapper.
 *
 * Scope: the rule is applied to direct dependencies. Indirect ones move as
 * their parents require and are not judged here.
 */
import { packageJsonViolations } from "./policy.ts";

const DIRECT_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];

export interface BumpInput {
  basePackageJson: string;
  headPackageJson: string;
  baseLock: string;
  headLock: string;
}

export interface BumpChange {
  name: string;
  from: string;
  to: string;
  level: "patch" | "minor";
}

export interface BumpVerdict {
  eligible: boolean;
  /** Why not, one line each. Empty when eligible. */
  reasons: string[];
  /** The direct dependencies whose installed version moved. */
  changes: BumpChange[];
}

type Json = Record<string, unknown>;

function parseObject(text: string): Json | null {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Json;
  } catch {
    return null;
  }
}

/** name -> the range written in package.json, across the direct sections. */
function directSpecs(pkg: Json): Map<string, string> {
  const specs = new Map<string, string>();
  for (const section of DIRECT_SECTIONS) {
    const entries = pkg[section];
    if (entries === null || typeof entries !== "object") continue;
    for (const [name, spec] of Object.entries(entries as Json)) {
      specs.set(name, String(spec));
    }
  }
  return specs;
}

function installedVersion(lock: Json, name: string): string | null {
  const packages = lock.packages;
  if (packages === null || typeof packages !== "object") return null;
  const entry = (packages as Json)[`node_modules/${name}`];
  if (entry === null || typeof entry !== "object") return null;
  const version = (entry as Json).version;
  return typeof version === "string" ? version : null;
}

/** Plain release versions only: no pre-release or build suffix. */
function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** A range that names registry versions, not a URL, git ref, tag or path. */
function isRegistryRange(spec: string): boolean {
  return /^(\^|~|>=|<=|=)?\d+(\.(\d+|x)){0,2}$/.test(spec);
}

export function classifyBump(input: BumpInput): BumpVerdict {
  const basePkg = parseObject(input.basePackageJson);
  const headPkg = parseObject(input.headPackageJson);
  const baseLock = parseObject(input.baseLock);
  const headLock = parseObject(input.headLock);
  if (!basePkg || !headPkg || !baseLock || !headLock) {
    return {
      eligible: false,
      reasons: ["package.json or the lockfile could not be read"],
      changes: [],
    };
  }

  const reasons = packageJsonViolations(
    input.basePackageJson,
    input.headPackageJson,
  );
  const changes: BumpChange[] = [];

  const before = directSpecs(basePkg);
  const after = directSpecs(headPkg);
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();

  for (const name of names) {
    const spec = after.get(name);
    if (spec === undefined) {
      reasons.push(`${name}: removed as a direct dependency`);
      continue;
    }
    if (!before.has(name)) {
      reasons.push(`${name}: added as a direct dependency`);
      continue;
    }
    if (spec !== before.get(name) && !isRegistryRange(spec)) {
      reasons.push(`${name}: now set to "${spec}", which is not a version range`);
      continue;
    }

    const from = installedVersion(baseLock, name);
    const to = installedVersion(headLock, name);
    if (from === null || to === null) {
      reasons.push(`${name}: not found in the lockfile`);
      continue;
    }
    if (from === to) continue;

    const a = parseVersion(from);
    const b = parseVersion(to);
    if (!a || !b) {
      reasons.push(`${name}: ${from} to ${to} is not a plain release version`);
      continue;
    }
    const older =
      b[0] < a[0] ||
      (b[0] === a[0] && (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2])));
    if (older) {
      reasons.push(`${name}: ${from} to ${to} is a downgrade`);
    } else if (b[0] !== a[0] || (a[0] === 0 && b[1] !== a[1])) {
      // Under semver a 0.x minor release may break, so it counts as major.
      reasons.push(`${name}: ${from} to ${to} is a major update`);
    } else {
      changes.push({
        name,
        from,
        to,
        level: b[1] !== a[1] ? "minor" : "patch",
      });
    }
  }

  return { eligible: reasons.length === 0, reasons, changes };
}
