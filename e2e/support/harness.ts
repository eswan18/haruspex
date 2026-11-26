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
import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import type { Seed } from "./seed";

function portFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a TCP port number, not "${raw}"`);
  }
  return port;
}

/**
 * The only place the ports are decided; every URL below derives from them.
 * Override with E2E_APP_PORT / E2E_IDP_PORT when 3100 / 3101 are taken.
 */
export const APP_PORT = portFromEnv("E2E_APP_PORT", 3100);
export const IDP_PORT = portFromEnv("E2E_IDP_PORT", 3101);

/** The one address the app and the IdP stub listen on. */
export const LOOPBACK = "127.0.0.1";
/**
 * How the browser, the specs and the app itself (`APP_BASE_URL`) address the
 * app, and the sign-in cookie's domain. It resolves to the loopback address
 * the app listens on (or to ::1, which global setup makes sure nothing answers
 * on).
 */
export const APP_HOST = "localhost";
export const APP_URL = `http://${APP_HOST}:${APP_PORT}`;
/** The IdP stub: `IDP_BASE_URL`, `IDP_PUBLIC_URL` and its tokens' `iss`. */
export const IDP_URL = `http://${LOOPBACK}:${IDP_PORT}`;

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
  /**
   * A session token for `Seed.user` that the IdP stub signed for another
   * app's audience (`ethanswan:other`), as plain text. The app must refuse it.
   */
  wrongAudienceToken: path.join(STATE_DIR, "wrong-audience-token.txt"),
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

/** Every address `localhost` can resolve to. */
const LOCALHOST_ADDRESSES = [LOOPBACK, "::1"];

/**
 * Throws if anything already answers on `port` at any address `localhost`
 * resolves to. The app listens only on `LOOPBACK`, but the browser reaches it
 * as `localhost`, so a server on ::1 could be reached instead.
 */
export async function assertPortFree(port: number): Promise<void> {
  const answers = await Promise.all(
    LOCALHOST_ADDRESSES.map((host) => acceptsConnections(port, host)),
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
    `Port ${port} is already in use; stop whatever is listening on it and re-run` +
      ` (or pick other ports with E2E_APP_PORT / E2E_IDP_PORT).\n${holder}`,
  );
}

/** A command's whole outcome, kept so a readiness failure can show it. */
interface Ran {
  command: string;
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

function run(file: string, args: string[]): Ran {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const error = result.error as NodeJS.ErrnoException | undefined;
  return {
    command: [file, ...args].join(" "),
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(error ? { error: `${error.code ?? ""} ${error.message}`.trim() } : {}),
  };
}

function describeRun(ran: Ran): string {
  const lines = [`$ ${ran.command}`, `  exit status: ${ran.status}`];
  if (ran.error) lines.push(`  spawn error: ${ran.error}`);
  lines.push(`  stdout: ${JSON.stringify(ran.stdout)}`);
  lines.push(`  stderr: ${JSON.stringify(ran.stderr)}`);
  return lines.join("\n");
}

/**
 * The pids with a listening TCP socket on `port`: bound to `host` only, when
 * given, otherwise on any address. Only processes this user may inspect are
 * visible, which is why the checks that use this never rest on it alone.
 */
function listenersOn(
  port: number,
  host?: string,
): { pids: number[]; ran: Ran } {
  const spec = host ? `-iTCP@${host}:${port}` : `-iTCP:${port}`;
  const ran = run("lsof", ["-nP", spec, "-sTCP:LISTEN", "-t"]);
  if (ran.error?.startsWith("ENOENT")) {
    throw new Error(
      "lsof is needed to prove the server on the app port is the one this run started",
    );
  }
  if (ran.status !== 0) return { pids: [], ran }; // lsof exits 1 when nothing matches
  const pids = [...new Set(ran.stdout.split("\n").filter(Boolean).map(Number))];
  return { pids, ran };
}

function processGroupOf(pid: number): { pgid: number | null; ran: Ran } {
  const ran = run("ps", ["-o", "pgid=", "-p", String(pid)]);
  if (ran.status !== 0) return { pgid: null, ran }; // no such process
  const out = ran.stdout.trim();
  return { pgid: out ? Number(out) : null, ran };
}

// --- the app ---------------------------------------------------------------

const STANDALONE = path.join(ROOT, ".next", "standalone");

/**
 * Lays the build out as the production image does (see the Dockerfile): the
 * traced standalone server, with `.next/static` copied in beside it. The copy
 * is the step Next's docs give for running `server.js` outside an image; it
 * is redone every run, so assets from an earlier build can never be served.
 */
function prepareStandaloneServer(): string {
  const server = path.join(STANDALONE, "server.js");
  const buildId = path.join(ROOT, ".next", "BUILD_ID");
  const standaloneBuildId = path.join(STANDALONE, ".next", "BUILD_ID");
  if (
    !fs.existsSync(server) ||
    !fs.existsSync(standaloneBuildId) ||
    fs.readFileSync(standaloneBuildId, "utf8") !==
      fs.readFileSync(buildId, "utf8")
  ) {
    throw new Error(
      'Run "npm run build" first (.next/standalone is missing or from another build)',
    );
  }
  const staticDir = path.join(STANDALONE, ".next", "static");
  fs.rmSync(staticDir, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, ".next", "static"), staticDir, { recursive: true });
  return server;
}

let app: {
  child: ChildProcess;
  exited: Promise<string>;
  log: fs.WriteStream;
} | null = null;

const HEALTH_TIMEOUT_MS = 60_000;

/**
 * Starts the standalone server (`node server.js`, as production does) on
 * `LOOPBACK`:`APP_PORT` with exactly `env`, and resolves once it is proven to
 * be the server answering there. Its stdout and stderr go to
 * `test-results/app.log`.
 */
export async function startApp(env: NodeJS.ProcessEnv): Promise<void> {
  const server = prepareStandaloneServer();
  fs.mkdirSync(path.dirname(APP_LOG), { recursive: true });
  const log = fs.createWriteStream(APP_LOG);
  // The app's stdout and stderr interleaved, as app.log has them, kept in
  // memory so a failure can print its tail without waiting on the file.
  let output = "";
  const record = (chunk: Buffer) => {
    log.write(chunk);
    output = (output + chunk.toString()).slice(-APP_LOG_TAIL_CHARS);
  };

  // Its own process group: teardown stops the group, and readiness asks
  // whether a listening socket belongs to it.
  const child = spawn(process.execPath, [server], {
    cwd: STANDALONE,
    env: { ...env, PORT: String(APP_PORT), HOSTNAME: LOOPBACK },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<string>((resolve) => {
    child.once("error", (error) =>
      resolve(`failed to start: ${error.message}`),
    );
    child.once("exit", (code, signal) =>
      resolve(signal ? `killed by ${signal}` : `exited with code ${code}`),
    );
  });
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);
  app = { child, exited, log };

  if (child.pid === undefined) {
    throw new Error(`Could not start the app: ${await exited}`);
  }
  fs.writeFileSync(
    PIDFILE,
    JSON.stringify({ runner: refTo(process.pid), app: refTo(child.pid) }),
  );

  const pgid = child.pid;
  const outcome: { stopped?: string } = {};
  void exited.then((how) => (outcome.stopped = how));

  // What the readiness loop last saw, and how often each condition held, so a
  // failure says which one never did.
  const seen = {
    polls: 0,
    listenerSeen: 0,
    listenerOwned: 0,
    healthAsked: 0,
    last: null as Ownership | null,
    lastHealth: "never asked",
  };
  const fail = async (message: string): Promise<never> => {
    const report = [
      `--- readiness: ${seen.polls} polls; lsof saw a listener on ${LOOPBACK}:${APP_PORT} in ${seen.listenerSeen}, all of it in the app's process group (${pgid}) in ${seen.listenerOwned}; /api/health asked ${seen.healthAsked} times, last: ${seen.lastHealth}`,
      `--- the app process: ${outcome.stopped ?? "still running"}`,
    ];
    if (seen.last) {
      report.push(`--- last ownership check`, describeRun(seen.last.lsof.ran));
      for (const ps of seen.last.groups) report.push(describeRun(ps.ran));
    }
    // Asked only now, and only to explain the failure: neither answer counts
    // towards readiness.
    report.push(
      `--- /api/health at ${LOOPBACK}:${APP_PORT}, ownership aside: ${await probeHealth()}`,
      `--- every listener on port ${APP_PORT}`,
      describeRun(run("lsof", ["-nP", `-iTCP:${APP_PORT}`, "-sTCP:LISTEN"])),
    );
    if (process.platform === "linux") {
      report.push(describeRun(run("ss", ["-ltnp", `sport = :${APP_PORT}`])));
    }
    report.push(
      `--- tail of the app log (${APP_LOG}) ---`,
      output || "(empty)",
      `--- end of the app log ---`,
    );
    console.error(report.join("\n"));
    throw new Error(message);
  };
  // Every socket listening on exactly LOOPBACK:APP_PORT is the child's. The
  // server does not set SO_REUSEPORT, so while it holds that address no other
  // socket can, and a connection to it reaches this socket ahead of any
  // wildcard listener. Whoever took the address first wins it outright: if
  // that is not the child, its listen fails with EADDRINUSE and it exits.
  const checkOwnership = (): Ownership => {
    const lsof = listenersOn(APP_PORT, LOOPBACK);
    const groups = lsof.pids.map((pid) => processGroupOf(pid));
    return {
      lsof,
      groups,
      owned:
        lsof.pids.length > 0 && groups.every((group) => group.pgid === pgid),
    };
  };

  // Ready: the child is proven to hold the address first, and only then is
  // /api/health asked, at that address, so the 200 can only be the child's.
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    if (outcome.stopped) {
      await fail(
        `The app ${outcome.stopped} before it was healthy (condition never reached: the app process stayed alive)`,
      );
    }
    if (Date.now() > deadline) {
      const condition =
        seen.listenerSeen === 0
          ? `lsof never saw a listener on ${LOOPBACK}:${APP_PORT}`
          : seen.listenerOwned === 0
            ? `the listener lsof saw on ${LOOPBACK}:${APP_PORT} was never all in the app's process group (${pgid})`
            : `/api/health never answered 200 (last: ${seen.lastHealth})`;
      await fail(
        `The app was not proven ready within ${HEALTH_TIMEOUT_MS / 1000}s: ${condition}`,
      );
    }
    seen.polls++;
    const ownership = checkOwnership();
    seen.last = ownership;
    if (ownership.lsof.pids.length > 0) seen.listenerSeen++;
    if (ownership.owned) {
      seen.listenerOwned++;
      seen.healthAsked++;
      seen.lastHealth = await probeHealth();
      if (seen.lastHealth === "200") break;
    }
    await delay(250);
  }

  // And at that moment, nothing else can be reached as localhost:APP_PORT: no
  // listener of any user on ::1 (the app listens only on LOOPBACK, so anything
  // answering there is someone else), and no listener this user can see on
  // any address outside the child's process group.
  const others = listenersOn(APP_PORT).pids.filter(
    (pid) => processGroupOf(pid).pgid !== pgid,
  );
  if (others.length > 0) {
    await fail(
      `Something besides the app is listening on port ${APP_PORT} (pid ${others.join(", ")})`,
    );
  }
  if (await acceptsConnections(APP_PORT, "::1")) {
    await fail(`Something besides the app is listening on [::1]:${APP_PORT}`);
  }
  if (outcome.stopped || !checkOwnership().owned) {
    await fail(
      `The app ${outcome.stopped ?? "lost its socket"} while starting`,
    );
  }
}

interface Ownership {
  lsof: { pids: number[]; ran: Ran };
  groups: { pgid: number | null; ran: Ran }[];
  owned: boolean;
}

/** How much of the app's output a failure prints. */
const APP_LOG_TAIL_CHARS = 8_000;

/** "200", another status, or why there was no answer. */
async function probeHealth(): Promise<string> {
  try {
    const response = await fetch(`http://${LOOPBACK}:${APP_PORT}/api/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    await response.body?.cancel();
    return String(response.status);
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return `no answer (${(error as Error).message}${cause ? `: ${cause}` : ""})`;
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
