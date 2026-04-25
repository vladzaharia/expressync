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

export async function generateTestEnv(): Promise<TestEnv> {
  const dir = await mktemp();
  const id = shortId();
  const values: Record<string, string> = {
    COMPOSE_PROJECT_NAME: `scanlogin-${id}`,
    STEVE_DB_PASSWORD: randomHex(16),
    EXPRESSYNC_DB_PASSWORD: randomHex(16),
    STEVE_PREAUTH_HMAC_KEY: randomHex(32),
    AUTH_SECRET: randomHex(32),
    STEVE_API_USERNAME: "admin",
    STEVE_API_KEY: randomHex(16),
    WEBAPI_VALUE: randomHex(16),
    CB_A: `CP-A-${shortId()}`,
    CB_B: `CP-B-${shortId()}`,
    TAG_GOOD: `tag-good-${shortId()}`,
    TAG_BLOCKED: `tag-blocked-${shortId()}`,
    TAG_UNKNOWN: `tag-unknown-${shortId()}`,
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
