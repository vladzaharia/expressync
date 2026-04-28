import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildSessionSummaryEmail,
  type SessionSummaryData,
} from "./session-summary.tsx";
import { renderTemplate } from "./template.tsx";

const session: SessionSummaryData = {
  id: "txn_abc123",
  chargerName: "Polaris HQ — Bay 2",
  started: "Apr 22, 2026 at 14:32",
  ended: "Apr 22, 2026 at 15:19",
  duration: "47 min",
  energy: "12.34 kWh",
  cost: "$4.56",
  cardLabel: "Tesla card (•••• 7421)",
};

Deno.test("session-summary: subject = 'Charging session ended', ≤ 50 chars", () => {
  const spec = buildSessionSummaryEmail({ to: "a@b", session });
  assertEquals(spec.subject, "Charging session ended");
  assert(spec.subject.length <= 50);
});

Deno.test("session-summary: brand polaris + category session-summary", () => {
  const spec = buildSessionSummaryEmail({ to: "a@b", session });
  assertEquals(spec.brand, "polaris");
  assertEquals(spec.category, "session-summary");
});

Deno.test("session-summary: preheader is 40–110 chars (any charger name)", () => {
  for (const name of ["A", "Polaris HQ — Bay 2", "X".repeat(80)]) {
    const spec = buildSessionSummaryEmail({
      to: "a@b",
      session: { ...session, chargerName: name },
    });
    assert(
      spec.preheader.length >= 40 && spec.preheader.length <= 110,
      `preheader for chargerName="${name}" is ${spec.preheader.length} chars`,
    );
  }
});

Deno.test("session-summary: CTA URL is on polaris.express", () => {
  const spec = buildSessionSummaryEmail({ to: "a@b", session });
  assert(spec.cta);
  assertEquals(
    spec.cta.url,
    "https://polaris.express/sessions/txn_abc123",
  );
});

Deno.test("session-summary: metadata contains all 7 rows when cost present", () => {
  const spec = buildSessionSummaryEmail({ to: "a@b", session });
  assert(spec.metadata);
  assertEquals(spec.metadata.length, 7);
  const labels = spec.metadata.map((r) => r.label);
  assertEquals(labels, [
    "Charger",
    "Started",
    "Ended",
    "Duration",
    "Energy",
    "Cost",
    "Card",
  ]);
});

Deno.test("session-summary: cost row uses emphasis styling", () => {
  const spec = buildSessionSummaryEmail({ to: "a@b", session });
  const costRow = spec.metadata?.find((r) => r.label === "Cost");
  assert(costRow);
  assertEquals(costRow.emphasis, true);
});

Deno.test("session-summary: omits cost row when cost is undefined", () => {
  const spec = buildSessionSummaryEmail({
    to: "a@b",
    session: { ...session, cost: undefined },
  });
  const labels = spec.metadata?.map((r) => r.label) ?? [];
  assert(!labels.includes("Cost"));
  assertEquals(labels.length, 6);
});

Deno.test("session-summary: footer note differs based on cost presence", () => {
  const withCost = buildSessionSummaryEmail({ to: "a@b", session });
  assertStringIncludes(
    withCost.footerNote ?? "",
    "Your invoice will be available",
  );

  const withoutCost = buildSessionSummaryEmail({
    to: "a@b",
    session: { ...session, cost: undefined },
  });
  assertStringIncludes(
    withoutCost.footerNote ?? "",
    "Cost will be available shortly",
  );
});

Deno.test("session-summary: renders without throwing", async () => {
  const rendered = await renderTemplate(
    buildSessionSummaryEmail({ to: "alice@example.com", session }),
  );
  assertStringIncludes(rendered.html, "Polaris HQ");
  assertStringIncludes(rendered.html, "12.34 kWh");
  assertStringIncludes(rendered.html, "$4.56");
  assertStringIncludes(
    rendered.text,
    "https://polaris.express/sessions/txn_abc123",
  );
});

Deno.test("session-summary: no admin-only data leakage", async () => {
  const rendered = await renderTemplate(
    buildSessionSummaryEmail({ to: "alice@example.com", session }),
  );
  assert(!rendered.html.toLowerCase().includes("expressync"));
  assert(!rendered.html.includes("manage.polaris.express"));
  assertEquals(
    rendered.fromHeader,
    "ExpressCharge <noreply@polaris.express>",
  );
});
