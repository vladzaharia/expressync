/**
 * Unit-level tests for the incremental billing emitter.
 *
 * The emitter has two surfaces — pure in-memory state machinery (this
 * file) and Lago / DB integration (covered by the integration harness in
 * `tests/integration/...`). Here we exercise the buffering, monotonic
 * guard, and shutdown without touching the network or DB.
 */

import {
  assertEquals,
  assertExists,
  assertStrictEquals,
} from "@std/assert";
import {
  _internal,
  enqueueMeterSample,
  shutdownIncrementalBilling,
} from "./incremental-billing.service.ts";

function clearStateForTest(): void {
  // Direct manipulation of the internal map is expedient here — the
  // module is a singleton so we don't have a per-test instance.
  for (const k of [..._internal.state.keys()]) _internal.state.delete(k);
}

Deno.test({
  name: "enqueueMeterSample anchors first sample without billing",
  fn: () => {
    clearStateForTest();
    enqueueMeterSample({
      steveTransactionId: 100,
      chargeBoxId: "EVSE-A",
      kwh: 1.5,
      meterTimestamp: new Date().toISOString(),
      isFinal: false,
    });
    const st = _internal.state.get(100);
    assertExists(st);
    assertEquals(st.lastMeterValueWh, 1500);
    assertEquals(st.startMeterValueWh, 1500);
    // No delta accumulated on the first (anchor) sample.
    assertEquals(st.pendingDeltaKwh, 0);
    shutdownIncrementalBilling();
  },
});

Deno.test({
  name: "enqueueMeterSample accumulates monotonic deltas",
  fn: () => {
    clearStateForTest();
    enqueueMeterSample({
      steveTransactionId: 200,
      chargeBoxId: "EVSE-B",
      kwh: 1.0,
      meterTimestamp: new Date().toISOString(),
      isFinal: false,
    });
    enqueueMeterSample({
      steveTransactionId: 200,
      chargeBoxId: "EVSE-B",
      kwh: 1.5, // +0.5 kWh
      meterTimestamp: new Date().toISOString(),
      isFinal: false,
    });
    enqueueMeterSample({
      steveTransactionId: 200,
      chargeBoxId: "EVSE-B",
      kwh: 1.7, // +0.2 kWh
      meterTimestamp: new Date().toISOString(),
      isFinal: false,
    });
    const st = _internal.state.get(200);
    assertExists(st);
    assertEquals(st.lastMeterValueWh, 1700);
    // 0.5 + 0.2 = 0.7 kWh pending.
    assertEquals(Math.round(st.pendingDeltaKwh * 1e3) / 1e3, 0.7);
    shutdownIncrementalBilling();
  },
});

Deno.test({
  name: "enqueueMeterSample drops out-of-order / negative samples",
  fn: () => {
    clearStateForTest();
    enqueueMeterSample({
      steveTransactionId: 300,
      chargeBoxId: "EVSE-C",
      kwh: 5.0,
      meterTimestamp: new Date().toISOString(),
      isFinal: false,
    });
    enqueueMeterSample({
      steveTransactionId: 300,
      chargeBoxId: "EVSE-C",
      kwh: 5.5, // +0.5 kWh
      meterTimestamp: new Date().toISOString(),
      isFinal: false,
    });
    // Out-of-order: lower meter than last seen → must be ignored.
    enqueueMeterSample({
      steveTransactionId: 300,
      chargeBoxId: "EVSE-C",
      kwh: 5.0, // lower than 5.5
      meterTimestamp: new Date().toISOString(),
      isFinal: false,
    });
    const st = _internal.state.get(300);
    assertExists(st);
    // lastMeterValueWh stays at the highest observed sample.
    assertEquals(st.lastMeterValueWh, 5500);
    assertEquals(Math.round(st.pendingDeltaKwh * 1e3) / 1e3, 0.5);
    shutdownIncrementalBilling();
  },
});

Deno.test({
  name: "enqueueMeterSample tolerates a 30Wh meter jitter without dropping",
  fn: () => {
    clearStateForTest();
    enqueueMeterSample({
      steveTransactionId: 400,
      chargeBoxId: "EVSE-D",
      kwh: 10.0,
      meterTimestamp: new Date().toISOString(),
      isFinal: false,
    });
    // 30Wh below the prior reading — within the 50Wh tolerance, so the
    // emitter accepts it without complaint (no meaningful delta though).
    enqueueMeterSample({
      steveTransactionId: 400,
      chargeBoxId: "EVSE-D",
      kwh: 9.97,
      meterTimestamp: new Date().toISOString(),
      isFinal: false,
    });
    const st = _internal.state.get(400);
    assertExists(st);
    // Sample was not classified as a rollback — pending stays 0.
    assertStrictEquals(st.pendingDeltaKwh, 0);
    shutdownIncrementalBilling();
  },
});

Deno.test({
  name: "shutdownIncrementalBilling clears state",
  fn: () => {
    clearStateForTest();
    enqueueMeterSample({
      steveTransactionId: 500,
      chargeBoxId: "EVSE-E",
      kwh: 1.0,
      meterTimestamp: new Date().toISOString(),
      isFinal: false,
    });
    assertEquals(_internal.state.size, 1);
    shutdownIncrementalBilling();
    assertEquals(_internal.state.size, 0);
  },
});

Deno.test({
  name: "enqueueMeterSample ignores non-numeric kWh",
  fn: () => {
    clearStateForTest();
    enqueueMeterSample({
      steveTransactionId: 600,
      chargeBoxId: "EVSE-F",
      kwh: null,
      meterTimestamp: null,
      isFinal: false,
    });
    assertEquals(_internal.state.size, 0);
    shutdownIncrementalBilling();
  },
});
