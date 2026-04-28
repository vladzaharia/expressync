import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { buildAdminPasswordResetEmail } from "./admin-password-reset.tsx";
import { renderTemplate } from "./template.tsx";

const URL = "https://manage.polaris.express/reset-password?token=abc123";

Deno.test("admin-password-reset: subject + brand (expressync) + category", () => {
  const spec = buildAdminPasswordResetEmail({
    to: "ops@example.com",
    url: URL,
  });
  assertEquals(spec.subject, "Reset your admin password");
  assertEquals(spec.brand, "expressync");
  assertEquals(spec.category, "admin-password-reset");
  assert(spec.subject.length <= 50);
});

Deno.test("admin-password-reset: preheader 40–110 chars", () => {
  const spec = buildAdminPasswordResetEmail({ to: "a@b", url: URL });
  assert(
    spec.preheader.length >= 40 && spec.preheader.length <= 110,
    `preheader is ${spec.preheader.length} chars`,
  );
});

Deno.test("admin-password-reset: CTA URL is on manage.polaris.express", () => {
  const spec = buildAdminPasswordResetEmail({ to: "a@b", url: URL });
  assert(spec.cta);
  assertStringIncludes(spec.cta.url, "manage.polaris.express");
});

Deno.test("admin-password-reset: highlights 24h expiry + single use", () => {
  const spec = buildAdminPasswordResetEmail({ to: "a@b", url: URL });
  const highlights = spec.body.filter((b) => b.type === "highlight");
  assertEquals(highlights.length, 1);
  const text = (highlights[0] as { text: string }).text;
  assertStringIncludes(text, "24 hours");
  assertStringIncludes(text, "once");
});

Deno.test("admin-password-reset: rendered email uses expressync sender + brand", async () => {
  const rendered = await renderTemplate(
    buildAdminPasswordResetEmail({ to: "ops@example.com", url: URL }),
  );
  assertEquals(
    rendered.fromHeader,
    "ExpressCharge Operator <admin-noreply@polaris.express>",
  );
  assertEquals(rendered.replyTo, "support@polaris.express");
  assertStringIncludes(rendered.html, "ExpressCharge");
  assertStringIncludes(rendered.text, URL);
});

Deno.test("admin-password-reset: footer reassures unrequested recipient", () => {
  const spec = buildAdminPasswordResetEmail({ to: "a@b", url: URL });
  assert(spec.footerNote);
  assertStringIncludes(spec.footerNote, "ignore");
});
