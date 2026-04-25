/**
 * compose.ts — thin shell over `docker compose` for spinning up, tearing
 * down, and inspecting the test stack defined in docker-compose.test.yml.
 */

import { registerCleanup } from "./env.ts";

const COMPOSE_FILE = new URL("../docker-compose.test.yml", import.meta.url)
  .pathname;

export interface ComposeContext {
  project: string;
  envPath: string;
}

async function run(
  args: string[],
  opts: { stdin?: string; capture?: boolean; quiet?: boolean } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("docker", {
    args,
    stdin: opts.stdin ? "piped" : "null",
    stdout: opts.capture ? "piped" : (opts.quiet ? "null" : "inherit"),
    stderr: opts.capture ? "piped" : (opts.quiet ? "null" : "inherit"),
  });
  const child = cmd.spawn();
  if (opts.stdin) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(opts.stdin));
    await writer.close();
  }
  const out = await child.output();
  const dec = new TextDecoder();
  return {
    code: out.code,
    stdout: opts.capture ? dec.decode(out.stdout) : "",
    stderr: opts.capture ? dec.decode(out.stderr) : "",
  };
}

function composeArgs(ctx: ComposeContext, extra: string[]): string[] {
  return [
    "compose",
    "--project-name",
    ctx.project,
    "--file",
    COMPOSE_FILE,
    "--env-file",
    ctx.envPath,
    ...extra,
  ];
}

export async function composeUp(
  ctx: ComposeContext,
  opts: { wait?: boolean; timeoutSec?: number } = {},
): Promise<void> {
  // Register teardown BEFORE `up` runs — partial-up failures (e.g. one
  // service crashes during build) still create containers and networks
  // that need cleaning. Registering after `up` returns would leak them.
  registerCleanup(() => composeDown(ctx));
  const args = ["up", "-d", "--build"];
  if (opts.wait) {
    args.push("--wait", "--wait-timeout", String(opts.timeoutSec ?? 600));
  }
  const r = await run(composeArgs(ctx, args));
  if (r.code !== 0) {
    throw new Error(`compose up failed (code=${r.code})`);
  }
}

/**
 * Tears down a project. Tries `docker compose down` first (with a 30s
 * stop timeout); on failure or hang, falls back to label-based force
 * removal so a stuck container can never block teardown.
 */
export async function composeDown(ctx: ComposeContext): Promise<void> {
  const downArgs = composeArgs(ctx, [
    "down",
    "-v",
    "--remove-orphans",
    "--timeout",
    "30",
  ]);
  const ok = await runWithDeadline(downArgs, 90_000);
  if (!ok) {
    console.warn(
      `[harness] compose down for ${ctx.project} did not finish cleanly — forcing`,
    );
    await forceTeardown(ctx.project);
  }
}

async function runWithDeadline(
  args: string[],
  deadlineMs: number,
): Promise<boolean> {
  const cmd = new Deno.Command("docker", {
    args,
    stdout: "null",
    stderr: "null",
  });
  const child = cmd.spawn();
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch { /* */ }
  }, deadlineMs);
  try {
    const { code } = await child.output();
    return code === 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Last-resort teardown for a project: list and force-remove every
 * container, network, and volume tagged with the compose project label.
 * Idempotent — safe to run on a project that's already gone.
 */
export async function forceTeardown(project: string): Promise<void> {
  const projectFilter = `label=com.docker.compose.project=${project}`;
  const ids = async (kind: "container" | "network" | "volume") => {
    const subcmd = kind === "container"
      ? ["ps", "-a"]
      : kind === "network"
      ? ["network", "ls"]
      : ["volume", "ls"];
    const r = await run([
      ...subcmd,
      "--filter",
      projectFilter,
      "--format",
      "{{.ID}}",
    ], { capture: true });
    return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  };
  const cids = await ids("container");
  if (cids.length) {
    await run(["rm", "-f", "-v", ...cids], { quiet: true });
  }
  const nids = await ids("network");
  for (const n of nids) {
    await run(["network", "rm", n], { quiet: true });
  }
  const vids = await ids("volume");
  if (vids.length) {
    await run(["volume", "rm", "-f", ...vids], { quiet: true });
  }
}

export async function getHostPort(
  ctx: ComposeContext,
  service: string,
  containerPort: number,
): Promise<{ host: string; port: number }> {
  // `docker compose port <service> <port>` returns "0.0.0.0:NNNN".
  const r = await run(
    composeArgs(ctx, ["port", service, String(containerPort)]),
    { capture: true },
  );
  if (r.code !== 0) {
    throw new Error(
      `compose port failed for ${service}:${containerPort}: ${r.stderr}`,
    );
  }
  const line = r.stdout.trim().split("\n").find((l) => l.includes(":")) ?? "";
  const [host, port] = line.split(":");
  if (!port) throw new Error(`could not parse host:port from "${line}"`);
  // Map 0.0.0.0 → 127.0.0.1 for client connections.
  return {
    host: host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host,
    port: parseInt(port, 10),
  };
}

export async function execInService(
  ctx: ComposeContext,
  service: string,
  cmd: string[],
  opts: { stdin?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await run(
    composeArgs(ctx, ["exec", "-T", service, ...cmd]),
    { stdin: opts.stdin, capture: true },
  );
}

export async function restartService(
  ctx: ComposeContext,
  service: string,
): Promise<void> {
  await run(composeArgs(ctx, ["restart", service]), { quiet: true });
}

export async function recreateService(
  ctx: ComposeContext,
  service: string,
): Promise<void> {
  await run(
    composeArgs(ctx, ["up", "-d", "--force-recreate", "--no-deps", service]),
  );
}

export interface LogStream {
  /** ring of recent lines */
  buffer: string[];
  /** waits until matcher returns true on any line (or timeout) */
  waitFor(
    matcher: RegExp | ((line: string) => boolean),
    timeoutMs?: number,
  ): Promise<string>;
  /** asserts current ring has a match */
  has(matcher: RegExp): boolean;
  stop(): void;
}

export function streamLogs(
  ctx: ComposeContext,
  service: string,
  ringSize = 2000,
): LogStream {
  const buffer: string[] = [];
  const cmd = new Deno.Command("docker", {
    args: composeArgs(ctx, ["logs", "-f", "--tail", "200", service]),
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();

  const waiters: Array<{
    test: (line: string) => boolean;
    resolve: (line: string) => void;
  }> = [];

  function feed(line: string) {
    buffer.push(line);
    if (buffer.length > ringSize) buffer.shift();
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].test(line)) {
        const w = waiters[i];
        waiters.splice(i, 1);
        w.resolve(line);
      }
    }
  }

  async function pump(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let acc = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        const parts = acc.split("\n");
        acc = parts.pop() ?? "";
        for (const p of parts) feed(p);
      }
      if (acc) feed(acc);
    } catch { /* stream closed */ }
  }
  pump(child.stdout);
  pump(child.stderr);

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    try {
      child.kill("SIGTERM");
    } catch { /* */ }
  }
  registerCleanup(async () => {
    stop();
  });

  return {
    buffer,
    has(matcher) {
      return buffer.some((l) => matcher.test(l));
    },
    waitFor(matcher, timeoutMs = 10_000) {
      const test = matcher instanceof RegExp
        ? (l: string) => matcher.test(l)
        : matcher;
      // Look in existing buffer first.
      const existing = buffer.find(test);
      if (existing) return Promise.resolve(existing);
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.test === test);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(
            new Error(
              `streamLogs.waitFor timed out after ${timeoutMs}ms (matcher=${matcher})`,
            ),
          );
        }, timeoutMs);
        waiters.push({
          test,
          resolve: (line) => {
            clearTimeout(timer);
            resolve(line);
          },
        });
      });
    },
    stop,
  };
}
