import { assertEquals } from "@std/assert";
import {
  calculateDelta,
  type TransactionWithCompletion,
} from "./transaction-processor.ts";

function makeTx(
  overrides: Partial<TransactionWithCompletion> = {},
): TransactionWithCompletion {
  return {
    id: 1,
    chargeBoxId: "CB01",
    chargeBoxPk: 1,
    connectorId: 1,
    ocppIdTag: "TAG01",
    ocppTagPk: 1,
    startTimestamp: "2025-01-01T00:00:00Z",
    startValue: "0",
    stopTimestamp: null,
    stopValue: null,
    stopEventActor: null,
    stopReason: null,
    isCompleted: false,
    ...overrides,
  };
}

Deno.test("calculateDelta - completed transaction with valid start/stop values", () => {
  const tx = makeTx({
    isCompleted: true,
    startValue: "1000",
    stopValue: "5000",
    stopTimestamp: "2025-01-01T01:00:00Z",
  });

  const result = calculateDelta(tx);

  assertEquals(result, {
    kwhDelta: 4,
    meterValueFrom: 1000,
    meterValueTo: 5000,
  });
});

Deno.test("calculateDelta - stopValue equals startValue returns null", () => {
  const tx = makeTx({
    isCompleted: true,
    startValue: "3000",
    stopValue: "3000",
    stopTimestamp: "2025-01-01T01:00:00Z",
  });

  const result = calculateDelta(tx);

  assertEquals(result, null);
});

Deno.test("calculateDelta - negative delta returns null", () => {
  const tx = makeTx({
    isCompleted: true,
    startValue: "5000",
    stopValue: "3000",
    stopTimestamp: "2025-01-01T01:00:00Z",
  });

  const result = calculateDelta(tx);

  assertEquals(result, null);
});

Deno.test("calculateDelta - active/incomplete transaction returns null", () => {
  const tx = makeTx({
    isCompleted: false,
    startValue: "1000",
    stopValue: "5000",
    stopTimestamp: "2025-01-01T01:00:00Z",
  });

  const result = calculateDelta(tx);

  assertEquals(result, null);
});

Deno.test("calculateDelta - null stopValue returns null", () => {
  const tx = makeTx({
    isCompleted: true,
    startValue: "1000",
    stopValue: null,
  });

  const result = calculateDelta(tx);

  assertEquals(result, null);
});

Deno.test("calculateDelta - Wh to kWh conversion", () => {
  const tx = makeTx({
    isCompleted: true,
    startValue: "0",
    stopValue: "1500",
    stopTimestamp: "2025-01-01T01:00:00Z",
  });

  const result = calculateDelta(tx);

  assertEquals(result, {
    kwhDelta: 1.5,
    meterValueFrom: 0,
    meterValueTo: 1500,
  });
});
