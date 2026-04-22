import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { buildMagicLinkEmail } from "./magic-link.tsx";
import { renderTemplate } from "./template.tsx";

const URL = "https://polaris.express/auth/verify?token=abc123";

Deno.test("magic-link: subject + brand + category", () => {
  const spec = buildMagicLinkEmail({ to: "alice@example.com", url: URL });
  assertEquals(spec.subject, "Sign in to Polaris Express");
  assertEquals(spec.brand, "polaris");
  assertEquals(spec.category, "magic-link");
});

Deno.test("magic-link: subject ≤ 50 chars", () => {
  const spec = buildMagicLinkEmail({ to: "a@b", url: URL });
  assert(spec.subject.length <= 50, `subject is ${spec.subject.length} chars`);
});

Deno.test("magic-link: preheader is 40–110 chars", () => {
  const spec = buildMagicLinkEmail({ to: "a@b", url: URL });
  assert(
    spec.preheader.length >= 40 && spec.preheader.length <= 110,
    `preheader is ${spec.preheader.length} chars`,
  );
});

Deno.test("magic-link: CTA URL uses polaris.express host", () => {
  const spec = buildMagicLinkEmail({ to: "a@b", url: URL });
  assert(spec.cta);
  assert(
    spec.cta.url.startsWith("https://polaris.express") ||
      spec.cta.url.startsWith("https://manage.polaris.express"),
    `CTA url ${spec.cta.url} is not on the allowlisted host`,
  );
});

Deno.test("magic-link: renders without throwing", async () => {
  const rendered = await renderTemplate(
    buildMagicLinkEmail({ to: "alice@example.com", url: URL }),
  );
  assertStringIncludes(rendered.html, "Sign in");
  assertStringIncludes(rendered.html, URL);
  assertStringIncludes(rendered.text, URL);
});

Deno.test("magic-link: footer reminds reader to ignore if unrequested", () => {
  const spec = buildMagicLinkEmail({ to: "a@b", url: URL });
  assert(spec.footerNote);
  assertStringIncludes(spec.footerNote, "Ignore this email");
});

Deno.test("magic-link: highlights 15-minute expiry", () => {
  const spec = buildMagicLinkEmail({ to: "a@b", url: URL });
  const highlights = spec.body.filter((b) => b.type === "highlight");
  assertEquals(highlights.length, 1);
  assertStringIncludes(
    (highlights[0] as { text: string }).text,
    "15 minutes",
  );
});

Deno.test("magic-link: no admin-only data leakage", async () => {
  // The magic-link email should NOT mention admin-specific things like
  // "operator", "ExpresSync", or include manage.* URLs.
  const rendered = await renderTemplate(
    buildMagicLinkEmail({ to: "alice@example.com", url: URL }),
  );
  assert(!rendered.html.toLowerCase().includes("expressync"));
  assert(!rendered.html.includes("manage.polaris.express"));
  assert(!rendered.text.toLowerCase().includes("expressync"));
  assertEquals(
    rendered.fromHeader,
    "Polaris Express <noreply@polaris.express>",
  );
});
