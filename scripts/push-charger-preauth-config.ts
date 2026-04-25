#!/usr/bin/env -S deno run -A
/**
 * push-charger-preauth-config.ts
 *
 * Pushes the four OCPP ConfigurationKeys that the scan-to-login pre-auth
 * hook depends on to a single charger via SteVe's `ChangeConfiguration`
 * REST operation. Without these flags, a charger may decide locally that
 * a cached tag is authorized and auto-start a transaction without ever
 * consulting the central system — bypassing our hook.
 *
 * Keys pushed:
 *   - LocalPreAuthorize       = false
 *   - LocalAuthorizeOffline   = false
 *   - AuthorizationCacheEnabled = false
 *   - LocalAuthListEnabled    = false
 *
 * Usage:
 *   deno run -A scripts/push-charger-preauth-config.ts <chargeBoxId>
 *
 * Exits non-zero if any of the four operations fail. Each operation's
 * `taskId` and finished/error state is printed to stdout so the operator
 * can correlate with SteVe's task UI.
 */

import { steveClient } from "../src/lib/steve-client.ts";
import type { OcppTaskResult } from "../src/lib/types/steve.ts";

const KEYS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "LocalPreAuthorize", value: "false" },
  { key: "LocalAuthorizeOffline", value: "false" },
  { key: "AuthorizationCacheEnabled", value: "false" },
  { key: "LocalAuthListEnabled", value: "false" },
];

function summarize(result: OcppTaskResult): string {
  const parts: string[] = [`taskId=${result.taskId}`];
  if (result.taskFinished !== undefined) {
    parts.push(`finished=${result.taskFinished}`);
  }
  const successCount = result.successResponses?.length ?? 0;
  const errorCount = result.errorResponses?.length ?? 0;
  const exceptionCount = result.exceptions?.length ?? 0;
  parts.push(
    `success=${successCount} errors=${errorCount} exceptions=${exceptionCount}`,
  );
  return parts.join(" ");
}

function hasFailure(result: OcppTaskResult): boolean {
  return (result.errorResponses?.length ?? 0) > 0 ||
    (result.exceptions?.length ?? 0) > 0;
}

async function main(): Promise<void> {
  const chargeBoxId = Deno.args[0];
  if (!chargeBoxId) {
    console.error(
      "Usage: deno run -A scripts/push-charger-preauth-config.ts <chargeBoxId>",
    );
    Deno.exit(2);
  }

  console.log(`Pushing pre-auth config to ${chargeBoxId}…`);

  let anyFailed = false;
  for (const { key, value } of KEYS) {
    try {
      const res = await steveClient.operations.changeConfiguration({
        chargeBoxId,
        key,
        value,
      });
      const failed = hasFailure(res);
      anyFailed = anyFailed || failed;
      const tag = failed ? "FAIL" : "OK  ";
      console.log(`  [${tag}] ${key}=${value}  ${summarize(res)}`);
      if (failed && res.errorResponses) {
        for (const e of res.errorResponses) {
          console.log(
            `         err: ${e.errorCode ?? "?"} ${
              e.errorDescription ?? ""
            } ${e.errorDetails ?? ""}`,
          );
        }
      }
      if (failed && res.exceptions) {
        for (const x of res.exceptions) {
          console.log(`         exc: ${x.exceptionMessage ?? "?"}`);
        }
      }
    } catch (err) {
      anyFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  [FAIL] ${key}=${value}  ${message}`);
    }
  }

  if (anyFailed) {
    console.error("One or more ChangeConfiguration operations failed.");
    Deno.exit(1);
  }
  console.log("All four keys pushed successfully.");
}

if (import.meta.main) {
  await main();
}
