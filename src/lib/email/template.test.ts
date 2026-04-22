import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { renderTemplate } from "./template.tsx";
import type { EmailTemplate } from "./types.ts";

function baseSpec(overrides: Partial<EmailTemplate> = {}): EmailTemplate {
  return {
    brand: "polaris",
    category: "magic-link",
    subject: "Hello there",
    preheader:
      "This preheader is exactly long enough to satisfy validation rules.",
    title: "Hello",
    body: [{ type: "paragraph", text: "First paragraph." }],
    cta: {
      label: "Click me",
      url: "https://polaris.express/auth/verify?token=abc",
    },
    ...overrides,
  };
}

Deno.test("renderTemplate produces valid HTML5 with DOCTYPE", () => {
  const out = renderTemplate(baseSpec());
  assertStringIncludes(out.html, "<!doctype html>");
  assertStringIncludes(out.html, "<html");
  assertStringIncludes(out.html, "</html>");
  assertStringIncludes(out.html, "<body");
  assertEquals(out.subject, "Hello there");
  assertEquals(out.fromHeader, "Polaris Express <noreply@polaris.express>");
  assertEquals(out.replyTo, "support@polaris.express");
});

Deno.test("renderTemplate inlines styles via juice", () => {
  const out = renderTemplate(baseSpec());
  // juice converts class/element selectors into inline style="…" attrs.
  // The `<table>` we render with bgcolor F4F1EC + style background-color
  // should end up with inline style attributes.
  assertStringIncludes(out.html, 'style="');
});

Deno.test("renderTemplate emits MSO conditional + Office settings", () => {
  const out = renderTemplate(baseSpec());
  assertStringIncludes(out.html, "<!--[if mso]>");
  assertStringIncludes(out.html, "OfficeDocumentSettings");
  assertStringIncludes(out.html, "v:roundrect");
});

Deno.test("renderTemplate includes color-scheme + dark-mode meta", () => {
  const out = renderTemplate(baseSpec());
  assertStringIncludes(out.html, 'name="color-scheme"');
  assertStringIncludes(out.html, "prefers-color-scheme: dark");
  assertStringIncludes(out.html, "[data-ogsc]");
});

Deno.test("renderTemplate emits hidden preheader", () => {
  const out = renderTemplate(baseSpec({ preheader: "X".repeat(50) }));
  // Preheader should be rendered with display:none style and contain the text.
  assertStringIncludes(out.html, "display:none");
  assertStringIncludes(out.html, "X".repeat(50));
});

// ---- Block type rendering ------------------------------------------------

Deno.test("paragraph block renders text", () => {
  const out = renderTemplate(
    baseSpec({ body: [{ type: "paragraph", text: "Custom paragraph copy." }] }),
  );
  assertStringIncludes(out.html, "Custom paragraph copy.");
});

Deno.test("highlight block renders with brand-tinted background", () => {
  const out = renderTemplate(
    baseSpec({ body: [{ type: "highlight", text: "Heads up!" }] }),
  );
  assertStringIncludes(out.html, "Heads up!");
  // Border-left in brand color.
  assertStringIncludes(out.html.toLowerCase(), "border-left");
});

Deno.test("code block uses monospace font family", () => {
  const out = renderTemplate(
    baseSpec({ body: [{ type: "code", text: "ABC-123-XYZ" }] }),
  );
  assertStringIncludes(out.html, "ABC-123-XYZ");
  assertStringIncludes(out.html.toLowerCase(), "monospace");
});

Deno.test("divider block renders a horizontal rule row", () => {
  const out = renderTemplate(
    baseSpec({
      body: [
        { type: "paragraph", text: "above" },
        { type: "divider" },
        { type: "paragraph", text: "below" },
      ],
    }),
  );
  assertStringIncludes(out.html, "above");
  assertStringIncludes(out.html, "below");
  assertStringIncludes(out.html.toLowerCase(), "border-top");
});

// ---- Brand variants -------------------------------------------------------

Deno.test("polaris brand emits Polaris Express from-header + accent", () => {
  const out = renderTemplate(baseSpec({ brand: "polaris" }));
  assertEquals(out.fromHeader, "Polaris Express <noreply@polaris.express>");
  // Polaris primary accent #0E7C66 should appear in inlined styles (button).
  assertStringIncludes(out.html.toLowerCase(), "#0e7c66");
});

Deno.test("expressync brand emits ExpresSync admin from-header + accent", () => {
  const out = renderTemplate(
    baseSpec({
      brand: "expressync",
      category: "admin-password-reset",
      subject: "Reset password",
    }),
  );
  assertEquals(
    out.fromHeader,
    "ExpresSync Operator <admin-noreply@polaris.express>",
  );
  assertStringIncludes(out.html.toLowerCase(), "#1561c4");
});

// ---- With/without CTA + metadata -----------------------------------------

Deno.test("no CTA → no <a href> button rendered", () => {
  const out = renderTemplate(baseSpec({ cta: undefined }));
  // No anchor with target=_blank (we only add that on the CTA button).
  assert(!out.html.includes('target="_blank"'));
});

Deno.test("metadata table renders rows with label/value", () => {
  const out = renderTemplate(
    baseSpec({
      metadata: [
        { label: "Energy", value: "12.34 kWh" },
        { label: "Cost", value: "$4.56", emphasis: true },
      ],
    }),
  );
  assertStringIncludes(out.html, "Energy");
  assertStringIncludes(out.html, "12.34 kWh");
  assertStringIncludes(out.html, "Cost");
  assertStringIncludes(out.html, "$4.56");
  // Emphasis row gets bold weight (700).
  assertStringIncludes(out.html, "font-weight:700");
});

Deno.test("footerNote appears in rendered output", () => {
  const out = renderTemplate(baseSpec({ footerNote: "Don't forget the cat." }));
  assertStringIncludes(out.html, "Don't forget the cat.");
});

// ---- Plain-text generation -----------------------------------------------

Deno.test("plain-text version contains the CTA URL", () => {
  const out = renderTemplate(baseSpec());
  assertStringIncludes(
    out.text,
    "https://polaris.express/auth/verify?token=abc",
  );
});

Deno.test("plain-text version uses CRLF line endings", () => {
  const out = renderTemplate(
    baseSpec({
      body: [
        { type: "paragraph", text: "first" },
        { type: "paragraph", text: "second" },
      ],
    }),
  );
  assertStringIncludes(out.text, "\r\n");
});

Deno.test("plain-text version includes title + each block + brand wordmark", () => {
  const out = renderTemplate(
    baseSpec({
      title: "Plain Title",
      body: [
        { type: "paragraph", text: "P1" },
        { type: "highlight", text: "H1" },
        { type: "code", text: "C1" },
        { type: "divider" },
      ],
    }),
  );
  assertStringIncludes(out.text, "Plain Title");
  assertStringIncludes(out.text, "P1");
  assertStringIncludes(out.text, "> H1");
  assertStringIncludes(out.text, "C1");
  assertStringIncludes(out.text, "---");
  assertStringIncludes(out.text, "Polaris Express");
});

Deno.test("plain-text version includes metadata rows", () => {
  const out = renderTemplate(
    baseSpec({
      metadata: [{ label: "Charger", value: "Bay 2" }],
    }),
  );
  assertStringIncludes(out.text, "Charger: Bay 2");
});

// ---- XSS / escape tests ---------------------------------------------------

Deno.test("XSS in paragraph: <script> tag rejected at render time", () => {
  assertThrows(
    () =>
      renderTemplate(
        baseSpec({
          body: [{ type: "paragraph", text: "<script>alert(1)</script>" }],
        }),
      ),
    Error,
    "forbidden markup",
  );
});

Deno.test("XSS in title: <iframe> tag rejected", () => {
  assertThrows(
    () =>
      renderTemplate(
        baseSpec({ title: "<iframe src='evil'>" }),
      ),
    Error,
    "forbidden markup",
  );
});

Deno.test("XSS in metadata value: <object> tag rejected", () => {
  assertThrows(
    () =>
      renderTemplate(
        baseSpec({
          metadata: [{ label: "x", value: "<object data='evil'></object>" }],
        }),
      ),
    Error,
    "forbidden markup",
  );
});

Deno.test("XSS in subject: <style> tag rejected", () => {
  assertThrows(
    () => renderTemplate(baseSpec({ subject: "<style>body{}</style>" })),
    Error,
    "forbidden markup",
  );
});

Deno.test("benign user input is HTML-escaped, not stripped", () => {
  // < as plain text must be escaped to &lt; so the rest of the document
  // doesn't get parsed as a tag. > and quotes don't need to be escaped in
  // text contexts (Preact's renderToString only escapes < and &).
  const out = renderTemplate(
    baseSpec({
      body: [{ type: "paragraph", text: "Cost is < $5 today" }],
    }),
  );
  assertStringIncludes(out.html, "Cost is &lt; $5 today");
  assert(!out.html.includes("Cost is < $5"));
});

// ---- URL allowlist --------------------------------------------------------

Deno.test("CTA with off-allowlist host throws", () => {
  assertThrows(
    () =>
      renderTemplate(
        baseSpec({
          cta: { label: "Evil", url: "https://evil.com/grab-token" },
        }),
      ),
    Error,
    "not in the allowlist",
  );
});

Deno.test("CTA with javascript: scheme throws", () => {
  assertThrows(
    () =>
      renderTemplate(
        baseSpec({
          cta: { label: "Evil", url: "javascript:alert(1)" },
        }),
      ),
    Error,
  );
});

Deno.test("CTA with http:// (insecure) throws", () => {
  assertThrows(
    () =>
      renderTemplate(
        baseSpec({
          cta: { label: "Plain", url: "http://polaris.express/sign-in" },
        }),
      ),
    Error,
    "not in the allowlist",
  );
});

Deno.test("CTA with https://manage.polaris.express is allowed", () => {
  const out = renderTemplate(
    baseSpec({
      cta: {
        label: "Reset",
        url: "https://manage.polaris.express/reset-password?token=xyz",
      },
    }),
  );
  assertStringIncludes(out.html, "manage.polaris.express/reset-password");
});

Deno.test("CTA with mailto: is allowed", () => {
  const out = renderTemplate(
    baseSpec({
      cta: { label: "Email us", url: "mailto:support@polaris.express" },
    }),
  );
  assertStringIncludes(out.html, "mailto:support@polaris.express");
});

// ---- Subject + preheader length validation -------------------------------

Deno.test("subject > 50 chars throws", () => {
  assertThrows(
    () => renderTemplate(baseSpec({ subject: "X".repeat(51) })),
    Error,
    "max 50",
  );
});

Deno.test("subject exactly 50 chars is allowed", () => {
  const out = renderTemplate(baseSpec({ subject: "X".repeat(50) }));
  assertEquals(out.subject.length, 50);
});

Deno.test("empty subject throws", () => {
  assertThrows(
    () => renderTemplate(baseSpec({ subject: "" })),
    Error,
    "non-empty",
  );
});

Deno.test("preheader < 40 chars throws", () => {
  assertThrows(
    () => renderTemplate(baseSpec({ preheader: "Too short" })),
    Error,
    "must be 40-110",
  );
});

Deno.test("preheader > 110 chars throws", () => {
  assertThrows(
    () => renderTemplate(baseSpec({ preheader: "X".repeat(111) })),
    Error,
    "must be 40-110",
  );
});

Deno.test("preheader at exactly 40 and 110 chars is allowed", () => {
  const at40 = renderTemplate(baseSpec({ preheader: "X".repeat(40) }));
  assertEquals(at40.preheader.length, 40);
  const at110 = renderTemplate(baseSpec({ preheader: "Y".repeat(110) }));
  assertEquals(at110.preheader.length, 110);
});

// ---- Snapshot-shape stability --------------------------------------------

Deno.test("rendered output has stable required fields", () => {
  const out = renderTemplate(baseSpec());
  assert(typeof out.subject === "string");
  assert(typeof out.preheader === "string");
  assert(typeof out.html === "string");
  assert(typeof out.text === "string");
  assert(typeof out.fromHeader === "string");
  assert(typeof out.replyTo === "string");
  assert(typeof out.category === "string");
  assert(out.html.length > 100);
  assert(out.text.length > 0);
});
