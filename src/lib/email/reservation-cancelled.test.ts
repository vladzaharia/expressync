import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildReservationCancelledEmail,
  type ReservationData,
} from "./reservation-cancelled.tsx";
import { renderTemplate } from "./template.tsx";

const reservation: ReservationData = {
  chargerName: "Polaris HQ — Bay 2",
  date: "Apr 22, 2026",
  time: "14:00 – 15:00",
};

Deno.test("reservation-cancelled: subject + brand + category", () => {
  const spec = buildReservationCancelledEmail({ to: "a@b", reservation });
  assertEquals(spec.subject, "Reservation cancelled");
  assertEquals(spec.brand, "polaris");
  assertEquals(spec.category, "reservation-cancelled");
  assert(spec.subject.length <= 50);
});

Deno.test("reservation-cancelled: preheader 40–110 chars across charger labels", () => {
  for (const name of ["A", "Polaris HQ — Bay 2", "X".repeat(50)]) {
    const spec = buildReservationCancelledEmail({
      to: "a@b",
      reservation: { ...reservation, chargerName: name },
    });
    assert(
      spec.preheader.length >= 40 && spec.preheader.length <= 110,
      `preheader for "${name}" is ${spec.preheader.length} chars`,
    );
  }
});

Deno.test("reservation-cancelled: CTA url is on polaris.express", () => {
  const spec = buildReservationCancelledEmail({ to: "a@b", reservation });
  assert(spec.cta);
  assertEquals(spec.cta.url, "https://polaris.express/reservations/new");
  assertEquals(spec.cta.label, "Make another reservation");
});

Deno.test("reservation-cancelled: metadata contains Charger / Date / Time", () => {
  const spec = buildReservationCancelledEmail({ to: "a@b", reservation });
  const labels = spec.metadata?.map((r) => r.label) ?? [];
  assertEquals(labels, ["Charger", "Date", "Time"]);
});

Deno.test("reservation-cancelled: reason is rendered as a highlight when provided", () => {
  const spec = buildReservationCancelledEmail({
    to: "a@b",
    reservation,
    reason: "Charger taken offline for maintenance",
  });
  const highlights = spec.body.filter((b) => b.type === "highlight");
  assertEquals(highlights.length, 1);
  assertStringIncludes(
    (highlights[0] as { text: string }).text,
    "Charger taken offline",
  );
});

Deno.test("reservation-cancelled: no highlight when reason omitted", () => {
  const spec = buildReservationCancelledEmail({ to: "a@b", reservation });
  const highlights = spec.body.filter((b) => b.type === "highlight");
  assertEquals(highlights.length, 0);
});

Deno.test("reservation-cancelled: renders without throwing", () => {
  const rendered = renderTemplate(
    buildReservationCancelledEmail({
      to: "alice@example.com",
      reservation,
      reason: "test",
    }),
  );
  assertStringIncludes(rendered.html, "Polaris HQ");
  assertStringIncludes(
    rendered.text,
    "https://polaris.express/reservations/new",
  );
});

Deno.test("reservation-cancelled: no admin-only data leakage", () => {
  const rendered = renderTemplate(
    buildReservationCancelledEmail({ to: "a@b", reservation }),
  );
  assert(!rendered.html.toLowerCase().includes("expressync"));
  assert(!rendered.html.includes("manage.polaris.express"));
  assertEquals(
    rendered.fromHeader,
    "Polaris Express <noreply@polaris.express>",
  );
});
