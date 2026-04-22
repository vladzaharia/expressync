#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env
/**
 * replay-lago-webhook.ts
 *
 * Reads a Lago webhook fixture JSON from a CLI argument and POSTs it to a
 * running ExpresSync instance's `/api/webhook/lago` endpoint. Useful for
 * exercising the discriminated-union dispatcher against real-shape fixtures
 * without needing live Lago events.
 *
 * USAGE:
 *   deno run -A scripts/replay-lago-webhook.ts <fixture.json>
 *   deno run -A scripts/replay-lago-webhook.ts <fixture.json> --url=http://localhost:8000
 *
 * Environment:
 *   EXPRESSYNC_URL — overrides the default http://localhost:8000 target. The
 *                    --url flag takes precedence.
 *
 * Exit codes: 0 on 2xx, non-zero on any other status or network failure.
 *
 * Example fixtures to save under `fixtures/`:
 *   - alert_triggered.json
 *   - invoice_payment_status_updated_failed.json
 *   - wallet_transaction_payment_failure.json
 */

function parseArgs(args: string[]): {
  fixturePath: string | undefined;
  baseUrl: string;
} {
  let fixturePath: string | undefined;
  let baseUrl = Deno.env.get("EXPRESSYNC_URL") ?? "http://localhost:8000";

  for (const arg of args) {
    if (arg.startsWith("--url=")) {
      baseUrl = arg.slice("--url=".length);
    } else if (!arg.startsWith("--")) {
      fixturePath = arg;
    }
  }

  return { fixturePath, baseUrl };
}

function usage(): never {
  console.error(
    "Usage: deno run -A scripts/replay-lago-webhook.ts <fixture.json> [--url=http://localhost:8000]",
  );
  Deno.exit(2);
}

async function main(): Promise<void> {
  const { fixturePath, baseUrl } = parseArgs(Deno.args);

  if (!fixturePath) usage();

  let payload: unknown;
  try {
    const raw = await Deno.readTextFile(fixturePath);
    payload = JSON.parse(raw);
  } catch (err) {
    console.error(
      `Failed to read/parse fixture at ${fixturePath}:`,
      err instanceof Error ? err.message : err,
    );
    Deno.exit(3);
  }

  const target = `${baseUrl.replace(/\/+$/, "")}/api/webhook/lago`;
  console.log(`POST ${target}`);
  console.log(
    `webhook_type=${
      (payload as { webhook_type?: unknown } | null)?.webhook_type ?? "(none)"
    }`,
  );

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    console.log(`← ${response.status} ${response.statusText}`);
    console.log(text);
    if (!response.ok) Deno.exit(1);
  } catch (err) {
    console.error(
      "Network/fetch failure:",
      err instanceof Error ? err.message : err,
    );
    Deno.exit(4);
  }
}

if (import.meta.main) {
  await main();
}
