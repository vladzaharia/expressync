/**
 * runner.ts — orchestrates the scan-login integration suite end-to-end:
 *
 *   1. Generate per-run env file (random secrets, charge-box ids, tags).
 *   2. Build the cpsim Go binary into a temp path.
 *   3. `docker compose up --build --wait` against docker-compose.test.yml
 *      with --project-name = scanlogin-<short>.
 *   4. Discover the host-mapped ports for steve:8180 and expressync-app:8000.
 *   5. Seed mariadb (ocpp_tag, charge_box) and postgres (users, user_mappings).
 *   6. `deno test scan_login_test.ts` with the discovered URLs in env.
 *   7. Tear down the stack on success, failure, or signal.
 */

import { generateTestEnv, runCleanups } from "./harness/env.ts";
import { composeUp, getHostPort } from "./harness/compose.ts";
import { seedExpressync, seedSteve } from "./harness/seed.ts";
import { sweepOrphans } from "./harness/sweep.ts";

const CLEANUP_DEADLINE_MS = 120_000;

let cleaningUp = false;
async function cleanupAndExit(code: number) {
  if (cleaningUp) return;
  cleaningUp = true;
  console.log("[runner] cleaning up...");
  // Bound the cleanup window so a hung compose-down can't keep the
  // runner alive forever — at the deadline we fall through and exit,
  // and any leftover stack will be reaped by the next run's sweep.
  const deadline = new Promise<void>((resolve) =>
    setTimeout(() => {
      console.error(
        `[runner] cleanup deadline (${CLEANUP_DEADLINE_MS}ms) hit — exiting; leftover stacks (if any) will be reaped on next run`,
      );
      resolve();
    }, CLEANUP_DEADLINE_MS)
  );
  await Promise.race([runCleanups(), deadline]);
  Deno.exit(code);
}

const onSignal = () => {
  cleanupAndExit(130);
};
Deno.addSignalListener("SIGINT", onSignal);
Deno.addSignalListener("SIGTERM", onSignal);
Deno.addSignalListener("SIGHUP", onSignal);

async function buildCpsim(outDir: string): Promise<string> {
  const out = `${outDir}/cpsim`;
  const dir = new URL("./cpsim", import.meta.url).pathname;
  const cmd = new Deno.Command("go", {
    args: ["build", "-o", out, "./cmd/cpsim"],
    cwd: dir,
    env: { GO111MODULE: "on" },
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();
  if (code !== 0) throw new Error("go build cpsim failed");
  return out;
}

async function main() {
  console.log("[runner] sweeping orphan stacks from prior runs...");
  const swept = await sweepOrphans({ excludePid: Deno.pid, verbose: true });
  if (swept.orphans.length) {
    console.log(
      `[runner] reaped ${swept.orphans.length} orphan stack(s): ${
        swept.orphans.join(", ")
      }`,
    );
  }

  console.log("[runner] generating env...");
  const env = await generateTestEnv();
  const project = env.values.COMPOSE_PROJECT_NAME;
  console.log(`[runner] project=${project}`);

  console.log("[runner] building cpsim...");
  const cpsimBin = await buildCpsim(env.envDir);

  console.log(
    "[runner] composing up (this builds SteVe + ExpresSync, may take 5+ minutes)...",
  );
  await composeUp({ project, envPath: env.envPath }, {
    wait: true,
    timeoutSec: 900,
  });

  console.log("[runner] discovering host ports...");
  const steve = await getHostPort(
    { project, envPath: env.envPath },
    "steve",
    8180,
  );
  const app = await getHostPort(
    { project, envPath: env.envPath },
    "expressync-app",
    8000,
  );
  console.log(
    `[runner] steve at ${steve.host}:${steve.port}, expressync at ${app.host}:${app.port}`,
  );

  console.log("[runner] seeding databases...");
  const seedVals = {
    CB_A: env.values.CB_A,
    CB_B: env.values.CB_B,
    TAG_GOOD: env.values.TAG_GOOD,
    TAG_BLOCKED: env.values.TAG_BLOCKED,
    TAG_UNKNOWN: env.values.TAG_UNKNOWN,
    STEVE_DB_PASSWORD: env.values.STEVE_DB_PASSWORD,
  };
  await seedSteve({ project, envPath: env.envPath }, seedVals);
  await seedExpressync({ project, envPath: env.envPath }, seedVals);

  // Compose env exported to deno test process.
  const testEnv: Record<string, string> = {
    ...Deno.env.toObject(),
    ...env.values,
    TEST_PROJECT: project,
    TEST_ENV_PATH: env.envPath,
    EXPRESSYNC_BASE_URL: `http://${app.host}:${app.port}`,
    STEVE_WS_URL:
      `ws://${steve.host}:${steve.port}/steve/websocket/CentralSystemService`,
    CPSIM_BIN: cpsimBin,
  };

  console.log("[runner] running deno test...");
  const testFile = new URL("./scan_login_test.ts", import.meta.url).pathname;
  const cmd = new Deno.Command("deno", {
    args: [
      "test",
      "--allow-net",
      "--allow-env",
      "--allow-read",
      "--allow-run",
      "--allow-write",
      "--no-check",
      testFile,
    ],
    env: testEnv,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();

  console.log(`[runner] tests exited with code ${code}`);
  await cleanupAndExit(code);
}

main().catch(async (err) => {
  console.error("[runner] FATAL:", err);
  await cleanupAndExit(1);
});
