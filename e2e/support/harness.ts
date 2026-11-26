/**
 * What the smoke suite's config, global setup and global teardown share: the
 * fixed ports, where run state lives on disk, and the app and IdP stub that
 * global setup starts and global teardown stops.
 *
 * Global setup and teardown run in Playwright's runner process and share this
 * module, so the handles below are normally all teardown needs. The pidfile
 * covers the run that never reached teardown: the next global setup finds the
 * app it left behind and stops it.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import type { Seed } from "./seed";

export const APP_PORT = 3100;
export const IDP_PORT = 3101;
/** `localhost`, not 127.0.0.1: the sign-in cookie's domain is `localhost`. */
export const APP_URL = `http://localhost:${APP_PORT}`;

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const STATE_DIR = path.join(ROOT, "e2e", ".state");
/** Written by global setup; read by specs. */
export const STATE = {
  /** Playwright storage state signed in as `Seed.user`. */
  user: path.join(STATE_DIR, "user.json"),
  /** Playwright storage state signed in as `Seed.admin`, a site admin. */
  admin: path.join(STATE_DIR, "admin.json"),
  /** The `Seed` rows, as JSON. */
  seed: path.join(STATE_DIR, "seed.json"),
};
const PIDFILE = path.join(STATE_DIR, "pids.json");
const APP_LOG = path.join(ROOT, "test-results", "app.log");

type Jsonified<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K];
};
/** `seed.json`: the `Seed` rows after a JSON round trip (dates are ISO strings). */
export type SeedFile = { [K in keyof Seed]: Jsonified<Seed[K]> };

export function readSeed(): SeedFile {
  return JSON.parse(fs.readFileSync(STATE.seed, "utf8")) as SeedFile;
}

// --- processes -------------------------------------------------------------

/**
 * A process named by pid *and* start time, so a pid the OS has since handed to
 * something else is never mistaken for one this harness started.
 */
interface ProcessRef {
  pid: number;
  started: string;
}

function startTimeOf(pid: number): string | null {
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null; // ps exits non-zero when there is no such process
  }
}

function refTo(pid: number): ProcessRef {
  const started = startTimeOf(pid);
  if (!started) throw new Error(`Process ${pid} is not running`);
  return { pid, started };
}

function isRunning(ref: ProcessRef): boolean {
  return startTimeOf(ref.pid) === ref.started;
}

/** True while any process in the group led by `pgid` exists. */
function groupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // Already gone.
  }
}

async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await delay(100);
  }
  return true;
}

/** SIGTERM the whole process group, then SIGKILL whatever is left after 10s. */
async function stopGroup(pgid: number): Promise<void> {
  signalGroup(pgid, "SIGTERM");
  if (await waitFor(() => !groupExists(pgid), 10_000)) return;
  signalGroup(pgid, "SIGKILL");
  if (!(await waitFor(() => !groupExists(pgid), 5_000))) {
    throw new Error(`Could not stop process group ${pgid}`);
  }
}

interface Pidfile {
  runner: ProcessRef;
  app: ProcessRef;
}

function readPidfile(): Pidfile | null {
  try {
    return JSON.parse(fs.readFileSync(PIDFILE, "utf8")) as Pidfile;
  } catch {
    return null;
  }
}

/**
 * Leaves `STATE_DIR` empty and no app from an earlier run alive.
 *
 * An app is only stopped when the run that started it is gone: a live runner
 * means a second run is going on in this checkout, and stopping its app would
 * fail that run instead of this one.
 */
export async function clearEarlierRun(): Promise<void> {
  const earlier = readPidfile();
  if (earlier && isRunning(earlier.runner)) {
    throw new Error(
      `Another e2e run (pid ${earlier.runner.pid}) is using ${STATE_DIR}. Wait for it to finish.`,
    );
  }
  if (earlier && isRunning(earlier.app)) {
    console.log(
      `Stopping the app left behind by an earlier e2e run (pid ${earlier.app.pid})`,
    );
    await stopGroup(earlier.app.pid);
  }
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function acceptsConnections(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(1_000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * Throws if anything already answers on `port`. Otherwise the health check
 * could be answered by some other server, and every check after it would be
 * testing that server instead of this build.
 */
export async function assertPortFree(port: number): Promise<void> {
  const answers = await Promise.all(
    ["127.0.0.1", "::1"].map((host) => acceptsConnections(port, host)),
  );
  if (!answers.some(Boolean)) return;

  let holder = "";
  try {
    holder = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // lsof is only here to name the culprit.
  }
  throw new Error(
    `Port ${port} is already in use; stop whatever is listening on it and re-run.\n${holder}`,
  );
}

// --- the app ---------------------------------------------------------------

let app: {
  child: ChildProcess;
  exited: Promise<string>;
  log: fs.WriteStream;
} | null = null;

const HEALTH_TIMEOUT_MS = 60_000;

/**
 * Starts `next start` on `APP_PORT` with exactly `env` and resolves once
 * `/api/health` answers 200. Its stdout and stderr go to `test-results/app.log`.
 */
export async function startApp(env: NodeJS.ProcessEnv): Promise<void> {
  fs.mkdirSync(path.dirname(APP_LOG), { recursive: true });
  const log = fs.createWriteStream(APP_LOG);
  let stderr = "";

  // Its own process group, so teardown can stop npx and the server under it
  // together.
  const child = spawn("npx", ["next", "start", "-p", String(APP_PORT)], {
    cwd: ROOT,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<string>((resolve) => {
    child.once("error", (error) => resolve(`failed to start: ${error.message}`));
    child.once("exit", (code, signal) =>
      resolve(signal ? `killed by ${signal}` : `exited with code ${code}`),
    );
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.on("data", (chunk: Buffer) => {
    log.write(chunk);
    stderr += chunk.toString();
  });
  app = { child, exited, log };

  if (child.pid === undefined) {
    throw new Error(`Could not start the app: ${await exited}`);
  }
  fs.writeFileSync(
    PIDFILE,
    JSON.stringify({ runner: refTo(process.pid), app: refTo(child.pid) }),
  );

  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  const outcome: { stopped?: string } = {};
  void exited.then((how) => (outcome.stopped = how));
  while (!(await answersHealthy())) {
    if (outcome.stopped) {
      console.error(`--- app stderr ---\n${stderr}`);
      throw new Error(`The app ${outcome.stopped} before it was healthy`);
    }
    if (Date.now() > deadline) {
      console.error(`--- app stderr ---\n${stderr}`);
      throw new Error(
        `The app did not answer ${APP_URL}/api/health with 200 within ${HEALTH_TIMEOUT_MS / 1000}s`,
      );
    }
    await delay(250);
  }
}

async function answersHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${APP_URL}/api/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    await response.body?.cancel();
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Stops the app this run started. Never touches a pidfile another run wrote:
 * when setup refused to start because a second run was going on, teardown
 * still runs, and must leave that run alone.
 */
export async function stopApp(): Promise<void> {
  const recorded = readPidfile();
  const ours = recorded?.runner.pid === process.pid ? recorded : null;
  if (app) {
    const { child, log } = app;
    app = null;
    if (child.pid !== undefined) await stopGroup(child.pid);
    await new Promise<void>((resolve) => log.end(() => resolve()));
  } else if (ours && isRunning(ours.app)) {
    await stopGroup(ours.app.pid);
  }
  if (ours) fs.rmSync(PIDFILE, { force: true });
}

// --- the IdP stub ----------------------------------------------------------

let stub: { stop(): Promise<void> } | null = null;

/** Hands the started stub to `stopStub`. */
export function trackStub(started: { stop(): Promise<void> }): void {
  stub = started;
}

export async function stopStub(): Promise<void> {
  const started = stub;
  stub = null;
  await started?.stop();
}
