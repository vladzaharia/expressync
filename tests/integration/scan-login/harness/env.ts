/**
 * env.ts — generates a per-run environment file with random secrets.
 * Nothing is shared between runs; the file lives in `mktemp -d` and is
 * deleted on teardown via the registered cleanup callback.
 */

const enc = new TextEncoder();

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function shortId(): string {
  return randomHex(4);
}

export interface TestEnv {
  envPath: string;
  envDir: string;
  values: Record<string, string>;
  /** Same env file but with per-test overrides applied. Returns the path. */
  withOverrides(overrides: Record<string, string>): string;
  cleanup(): Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

export function registerCleanup(fn: () => Promise<void>) {
  cleanups.push(fn);
}

export async function runCleanups() {
  for (const fn of cleanups.splice(0)) {
    try {
      await fn();
    } catch (err) {
      console.error("[harness] cleanup error:", err);
    }
  }
}

async function mktemp(): Promise<string> {
  const cmd = new Deno.Command("mktemp", { args: ["-d"], stdout: "piped" });
  const out = await cmd.output();
  if (!out.success) throw new Error("mktemp failed");
  return new TextDecoder().decode(out.stdout).trim();
}

// SteVe's application-docker.properties bakes the DB and admin creds at
// Maven build time (Flyway/jOOQ both consume them as plain Maven
// properties — Maven's property reader doesn't do ${VAR:default}-style
// interpolation, so we cannot override them from env). To keep the test
// stack DB-cred-aligned with the SteVe image, the harness USES THE SAME
// values the image was built with. Everything else (HMAC, expressync
// secrets, charge-box ids, tag ids) is still randomized per run.
const STEVE_BAKED_DB_PASSWORD =
  "7RTZEWrXQ7PFXa50x83xDX4zY1DA4OODk72Z6ksREVobUf8cRV";
const STEVE_BAKED_AUTH_USER = "vlad";
const STEVE_BAKED_AUTH_PASSWORD =
  "g56nKbQjER2PE1xIu7ozJuikgBmN5ea6AWPoK55KI49Zk3RGsU";
const STEVE_BAKED_WEBAPI_VALUE =
  "2ec7JmU9l8cY41qQPe7yRKWwtuaB5YFNq5nDnx8FunDNrvK8gY";

export async function generateTestEnv(): Promise<TestEnv> {
  const dir = await mktemp();
  const id = shortId();
  const values: Record<string, string> = {
    COMPOSE_PROJECT_NAME: `scanlogin-${id}`,
    STEVE_DB_PASSWORD: STEVE_BAKED_DB_PASSWORD,
    EXPRESSYNC_DB_PASSWORD: randomHex(16),
    STEVE_PREAUTH_HMAC_KEY: randomHex(32),
    AUTH_SECRET: randomHex(32),
    STEVE_API_USERNAME: STEVE_BAKED_AUTH_USER,
    STEVE_API_KEY: STEVE_BAKED_AUTH_PASSWORD,
    WEBAPI_VALUE: STEVE_BAKED_WEBAPI_VALUE,
    CB_A: `CP-A-${shortId()}`,
    CB_B: `CP-B-${shortId()}`,
    TAG_GOOD: `tag-good-${shortId()}`,
    TAG_BLOCKED: `tag-blocked-${shortId()}`,
    TAG_UNKNOWN: `tag-unknown-${shortId()}`,
    // Stamped onto every container as labels so the orphan sweeper can
    // tell whether a leftover stack belongs to a still-running test.
    RUNNER_PID: String(Deno.pid),
    RUNNER_STARTED_AT: String(Date.now()),
  };

  const envPath = `${dir}/.env.test.${id}`;
  const body = Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
  await Deno.writeTextFile(envPath, body);
  await Deno.chmod(envPath, 0o600);

  const cleanup = async () => {
    try {
      await Deno.remove(dir, { recursive: true });
    } catch { /* swallow */ }
  };
  registerCleanup(cleanup);

  const withOverrides = (overrides: Record<string, string>): string => {
    const overridePath = `${dir}/.env.test.${id}.${randomHex(3)}`;
    const merged = { ...values, ...overrides };
    const body2 = Object.entries(merged)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";
    Deno.writeTextFileSync(overridePath, body2);
    Deno.chmodSync(overridePath, 0o600);
    return overridePath;
  };

  return { envPath, envDir: dir, values, withOverrides, cleanup };
}

export function _internal_enc() {
  return enc;
}
