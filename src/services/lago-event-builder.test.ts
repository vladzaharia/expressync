import { assertEquals } from "@std/assert";
import { batchEvents, buildLagoEvent } from "./lago-event-builder.ts";
import type { ProcessedTransaction } from "./transaction-processor.ts";
import type { LagoEvent } from "../lib/types/lago.ts";

function makeProcessed(
  overrides: Partial<ProcessedTransaction> = {},
): ProcessedTransaction {
  return {
    steveTransactionId: 42,
    userMappingId: 1,
    lagoSubscriptionExternalId: "sub_ext_001",
    kwhDelta: 12.345,
    meterValueFrom: 0,
    meterValueTo: 12345,
    isFinal: true,
    lagoEventTransactionId: "steve_tx_42_final",
    shouldSendToLago: true,
    skipReason: null,
    stopTimestamp: null,
    chargeBoxId: "CB01",
    connectorId: 1,
    startTimestamp: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDummyEvent(id: number): LagoEvent {
  return {
    transaction_id: `tx_${id}`,
    external_subscription_id: "sub_001",
    code: "ev_charging_kwh",
    timestamp: 1700000000,
    properties: { value: "1.000" },
  };
}

Deno.test("buildLagoEvent - correct event structure and fields", () => {
  const processed = makeProcessed();
  const event = buildLagoEvent(processed);

  assertEquals(event.transaction_id, "steve_tx_42_final");
  assertEquals(event.external_subscription_id, "sub_ext_001");
  assertEquals(
    event.code,
    Deno.env.get("LAGO_METRIC_CODE") || "ev_charging_kwh",
  );
  assertEquals(typeof event.timestamp, "number");
  assertEquals(typeof event.properties.value, "string");
});

Deno.test("buildLagoEvent - kWh rounded to 3 decimal places", () => {
  const processed = makeProcessed({ kwhDelta: 1.23456789 });
  const event = buildLagoEvent(processed);

  assertEquals(event.properties.value, "1.235");
});

Deno.test("buildLagoEvent - kWh with exact 3 decimal places", () => {
  const processed = makeProcessed({ kwhDelta: 5.1 });
  const event = buildLagoEvent(processed);

  assertEquals(event.properties.value, "5.100");
});

Deno.test("batchEvents - 100 events produce 1 batch", () => {
  const events = Array.from({ length: 100 }, (_, i) => makeDummyEvent(i));
  const batches = batchEvents(events);

  assertEquals(batches.length, 1);
  assertEquals(batches[0].length, 100);
});

Deno.test("batchEvents - 150 events produce 2 batches", () => {
  const events = Array.from({ length: 150 }, (_, i) => makeDummyEvent(i));
  const batches = batchEvents(events);

  assertEquals(batches.length, 2);
  assertEquals(batches[0].length, 100);
  assertEquals(batches[1].length, 50);
});

Deno.test("batchEvents - 0 events produce 0 batches", () => {
  const batches = batchEvents([]);

  assertEquals(batches.length, 0);
});
