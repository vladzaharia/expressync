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

// Test fixtures for the ephemeral SteVe + MariaDB stack the harness spins
// up. The mariadb container uses `tmpfs:/var/lib/mysql`, so it's
// initialized fresh on every run — these values are arbitrary fixtures,
// NOT production credentials. They live as constants (rather than
// randomized per-run) so the SteVe image build can bake them into Flyway
// for Maven-driven migrations during `docker build`. Rotating prod
// credentials does NOT require touching these — the harness's StEvE
// container is built from source against this fixture password, and the
// runtime `DB_PASSWORD` env var (passed below) is what Spring Boot uses
// to connect at startup.
const STEVE_TEST_DB_PASSWORD = "harness-fixture-db-pwd-2dQRpdv8VlNDtN";
const STEVE_TEST_AUTH_USER = "harness";
const STEVE_TEST_AUTH_PASSWORD = "harness-fixture-auth-pwd-O0SUiXfQqebXkr";
const STEVE_TEST_WEBAPI_VALUE = "harness-fixture-webapi-value-jhuJYn6vsuApGu";

export async function generateTestEnv(): Promise<TestEnv> {
  const dir = await mktemp();
  const id = shortId();
  const values: Record<string, string> = {
    COMPOSE_PROJECT_NAME: `scanlogin-${id}`,
    STEVE_DB_PASSWORD: STEVE_TEST_DB_PASSWORD,
    EXPRESSYNC_DB_PASSWORD: randomHex(16),
    STEVE_PREAUTH_HMAC_KEY: randomHex(32),
    AUTH_SECRET: randomHex(32),
    STEVE_API_USERNAME: STEVE_TEST_AUTH_USER,
    STEVE_API_KEY: STEVE_TEST_AUTH_PASSWORD,
    WEBAPI_VALUE: STEVE_TEST_WEBAPI_VALUE,
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
