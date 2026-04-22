/**
 * Wave A8 — SSE transport unit tests.
 *
 * Covers the in-memory transport (default path) and verifies the Postgres
 * transport enforces the 7KB payload cap without actually connecting to a
 * database. A live cross-process NOTIFY test is deliberately out of scope
 * for this ticket and slated for a follow-up once the flag flips.
 */

import { assertEquals } from "@std/assert";
import {
  InMemoryTransport,
  NOTIFY_MAX_PAYLOAD_BYTES,
  PostgresNotifyTransport,
} from "./sse-transport.ts";
import type { DeliveredEvent } from "../services/event-bus.service.ts";

function makeEvent(overrides: Partial<DeliveredEvent> = {}): DeliveredEvent {
  return {
    seq: 1,
    ts: Date.now(),
    type: "notification.created",
    payload: { id: 1, title: "test" },
    ...overrides,
  };
}

Deno.test("InMemoryTransport fan-out delivers to every subscriber", async () => {
  const transport = new InMemoryTransport();
  const received: DeliveredEvent[] = [];
  const received2: DeliveredEvent[] = [];

  const unsub1 = await transport.subscribe((e) => received.push(e));
  await transport.subscribe((e) => received2.push(e));

  await transport.publish(makeEvent({ seq: 1 }));
  await transport.publish(makeEvent({ seq: 2 }));

  assertEquals(received.length, 2);
  assertEquals(received2.length, 2);
  assertEquals(received[0].seq, 1);
  assertEquals(received[1].seq, 2);

  // Unsubscribe should stop further deliveries to that handler.
  unsub1();
  await transport.publish(makeEvent({ seq: 3 }));
  assertEquals(received.length, 2);
  assertEquals(received2.length, 3);

  await transport.close();
});

Deno.test("InMemoryTransport close clears handlers", async () => {
  const transport = new InMemoryTransport();
  const received: DeliveredEvent[] = [];
  await transport.subscribe((e) => received.push(e));
  await transport.close();
  await transport.publish(makeEvent());
  assertEquals(received.length, 0);
});

Deno.test("InMemoryTransport isolates throwing handlers", async () => {
  const transport = new InMemoryTransport();
  const received: DeliveredEvent[] = [];
  await transport.subscribe(() => {
    throw new Error("boom");
  });
  await transport.subscribe((e) => received.push(e));
  await transport.publish(makeEvent({ seq: 42 }));
  assertEquals(received.length, 1);
  assertEquals(received[0].seq, 42);
  await transport.close();
});

Deno.test("PostgresNotifyTransport drops payloads over 7KB cap", async () => {
  // Construct with a fake DSN; we never actually start LISTEN or connect.
  const transport = new PostgresNotifyTransport("postgres://nowhere/none");

  // Monkey-patch getNotifyClient to avoid opening real sockets.
  let notifyCalls = 0;
  // deno-lint-ignore no-explicit-any
  (transport as any).getNotifyClient = () => ({
    // deno-lint-ignore require-await
    notify: async (_channel: string, _payload: string) => {
      notifyCalls += 1;
    },
  });

  // Oversized payload: a single string larger than the cap.
  const big = "x".repeat(NOTIFY_MAX_PAYLOAD_BYTES + 100);
  await transport.publish(makeEvent({ payload: { blob: big } }));
  assertEquals(notifyCalls, 0, "oversized event must be dropped");

  // Small payload: should pass through.
  await transport.publish(makeEvent({ payload: { ok: true } }));
  assertEquals(notifyCalls, 1);

  await transport.close();
});

Deno.test("PostgresNotifyTransport subscribe/unsubscribe tracks handlers", async () => {
  const transport = new PostgresNotifyTransport("postgres://nowhere/none");
  const received: DeliveredEvent[] = [];
  const unsub = await transport.subscribe((e) => received.push(e));

  // Simulate an incoming NOTIFY by calling the private handler.
  const ev = makeEvent({ seq: 99 });
  // deno-lint-ignore no-explicit-any
  (transport as any).onNotification(JSON.stringify(ev));
  assertEquals(received.length, 1);
  assertEquals(received[0].seq, 99);

  unsub();
  // deno-lint-ignore no-explicit-any
  (transport as any).onNotification(JSON.stringify(makeEvent({ seq: 100 })));
  assertEquals(received.length, 1, "handler should no longer receive");

  await transport.close();
});

Deno.test("PostgresNotifyTransport tolerates malformed NOTIFY payloads", async () => {
  const transport = new PostgresNotifyTransport("postgres://nowhere/none");
  const received: DeliveredEvent[] = [];
  await transport.subscribe((e) => received.push(e));
  // deno-lint-ignore no-explicit-any
  (transport as any).onNotification("{not-json");
  assertEquals(received.length, 0);
  await transport.close();
});
