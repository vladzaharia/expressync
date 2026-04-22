/**
 * Unified email template renderer.
 *
 * One base layout, parameterised by brand + content blocks. Each
 * `EmailTemplate` spec is composed by a per-category builder
 * (`magic-link.tsx`, `session-summary.tsx`, …) and passed to
 * `renderTemplate`, which:
 *   1. Validates invariants (subject length, preheader length, URL allowlist,
 *      no XSS payloads in user-provided strings).
 *   2. Renders the Preact JSX to a string.
 *   3. Inlines all `<style>` rules with juice (so Outlook & friends, which
 *      strip <style> blocks, still see the styles).
 *   4. Returns both an HTML body and a plain-text alternative derived from
 *      the same `body` blocks (the text version is NOT generated from the
 *      HTML — that's lossy — but reduced from the structured spec).
 */

import { renderToString } from "preact-render-to-string";
import type { ComponentChildren, JSX } from "preact";

// Lazy import: juice + its CJS deps (cheerio → encoding-sniffer → iconv-lite,
// mensch) don't survive Rollup's ESM bundling for Fresh's SSR build. Loading
// it via runtime-computed specifier defeats Rollup's static analysis so the
// bundler never tries to crawl into juice's CJS graph.
let _juice: ((html: string, opts?: Record<string, unknown>) => string) | null =
  null;
async function getJuice() {
  if (_juice) return _juice;
  // Construct the module specifier at runtime so Rollup can't see "juice".
  const moduleId = ["jui", "ce"].join("");
  const mod = await import(/* @vite-ignore */ moduleId);
  _juice = (mod.default ?? mod) as (
    html: string,
    opts?: Record<string, unknown>,
  ) => string;
  return _juice;
}

import {
  ALLOWED_URL_PREFIXES,
  BRAND_ASSETS,
  type BrandAssets,
} from "./assets.ts";
import type {
  EmailBlock,
  EmailCta,
  EmailTemplate,
  MetadataRow,
  RenderedEmail,
} from "./types.ts";

// ---- Validation ------------------------------------------------------------

const SUBJECT_MAX = 50;
const PREHEADER_MIN = 40;
const PREHEADER_MAX = 110;

const FORBIDDEN_TOKENS = /<\s*(script|iframe|object|style)\b/i;

/** Reject any user string that smuggles in dangerous markup. */
function assertSafeUserString(field: string, value: string): void {
  if (FORBIDDEN_TOKENS.test(value)) {
    throw new Error(
      `Email render: ${field} contains forbidden markup (script/iframe/object/style)`,
    );
  }
}

function assertAllowedUrl(field: string, url: string): void {
  if (!ALLOWED_URL_PREFIXES.some((p) => url.startsWith(p))) {
    throw new Error(
      `Email render: ${field} URL "${url}" is not in the allowlist (${
        ALLOWED_URL_PREFIXES.join(", ")
      })`,
    );
  }
  // Even allowlisted URLs shouldn't smuggle in JS via crafted href; the
  // allowlist already excludes javascript: but be paranoid.
  if (/^javascript:/i.test(url)) {
    throw new Error(`Email render: ${field} URL uses javascript: scheme`);
  }
}

function validateSpec(spec: EmailTemplate): void {
  if (typeof spec.subject !== "string" || spec.subject.length === 0) {
    throw new Error("Email render: subject must be a non-empty string");
  }
  if (spec.subject.length > SUBJECT_MAX) {
    throw new Error(
      `Email render: subject is ${spec.subject.length} chars (max ${SUBJECT_MAX})`,
    );
  }
  if (typeof spec.preheader !== "string") {
    throw new Error("Email render: preheader must be a string");
  }
  if (
    spec.preheader.length < PREHEADER_MIN ||
    spec.preheader.length > PREHEADER_MAX
  ) {
    throw new Error(
      `Email render: preheader is ${spec.preheader.length} chars (must be ${PREHEADER_MIN}-${PREHEADER_MAX})`,
    );
  }
  if (typeof spec.title !== "string" || spec.title.length === 0) {
    throw new Error("Email render: title must be a non-empty string");
  }

  assertSafeUserString("subject", spec.subject);
  assertSafeUserString("preheader", spec.preheader);
  assertSafeUserString("title", spec.title);
  if (spec.footerNote) assertSafeUserString("footerNote", spec.footerNote);

  for (const [i, block] of spec.body.entries()) {
    if (block.type === "divider") continue;
    assertSafeUserString(`body[${i}].text`, block.text);
  }
  if (spec.metadata) {
    for (const [i, row] of spec.metadata.entries()) {
      assertSafeUserString(`metadata[${i}].label`, row.label);
      assertSafeUserString(`metadata[${i}].value`, row.value);
    }
  }
  if (spec.cta) {
    assertSafeUserString("cta.label", spec.cta.label);
    assertAllowedUrl("cta.url", spec.cta.url);
  }
}

// ---- HTML escape (Preact's renderToString already escapes children, but the
// bulletproof button is built via dangerouslySetInnerHTML for the MSO/VML
// conditional comments — we hand-escape there) ---------------------------------

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// ---- Layout components ----------------------------------------------------

interface LayoutProps {
  spec: EmailTemplate;
  brand: BrandAssets;
}

function Preheader(
  { text }: { text: string },
): JSX.Element {
  // Hidden preheader — shown next to subject in inbox preview but invisible
  // in the rendered email body. Trailing zero-width-non-joiners pad the
  // preview area so client-injected snippet text doesn't bleed in.
  return (
    <div
      style={{
        display: "none",
        maxHeight: "0",
        maxWidth: "0",
        overflow: "hidden",
        opacity: "0",
        color: "transparent",
        msoHide: "all",
        height: "0",
        width: "0",
        fontSize: "1px",
        lineHeight: "1px",
      }}
    >
      {text}
      {/* zero-width non-joiner padding */}
      {"‌ ".repeat(60)}
    </div>
  );
}

function Header({ brand }: { brand: BrandAssets }): JSX.Element {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding="0"
      cellSpacing="0"
      {...({ border: "0" } as Record<string, string>)}
      style={{ backgroundColor: "#F4F1EC" }}
    >
      <tr>
        <td align="center" style={{ padding: "32px 16px 16px" }}>
          <img
            src={brand.logoUrl}
            srcSet={`${brand.logoUrl} 1x, ${brand.logoUrl2x} 2x`}
            width="160"
            height="40"
            alt={brand.name}
            style={{
              display: "block",
              border: "0",
              outline: "none",
              textDecoration: "none",
              width: "160px",
              height: "40px",
              maxWidth: "160px",
            }}
          />
        </td>
      </tr>
    </table>
  );
}

function Title({ text }: { text: string }): JSX.Element {
  return (
    <h1
      style={{
        margin: "0 0 16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        fontSize: "24px",
        lineHeight: "32px",
        fontWeight: "700",
        color: "#1F2937",
      }}
    >
      {text}
    </h1>
  );
}

function Block({
  block,
  brand,
}: {
  block: EmailBlock;
  brand: BrandAssets;
}): JSX.Element {
  switch (block.type) {
    case "paragraph":
      return (
        <p
          style={{
            margin: "0 0 16px",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            fontSize: "16px",
            lineHeight: "24px",
            color: "#1F2937",
          }}
        >
          {block.text}
        </p>
      );
    case "highlight":
      return (
        <table
          role="presentation"
          width="100%"
          cellPadding="0"
          cellSpacing="0"
          {...({ border: "0" } as Record<string, string>)}
          style={{ margin: "0 0 16px" }}
        >
          <tr>
            <td
              style={{
                backgroundColor: `${brand.primaryHex}10`,
                borderLeft: `3px solid ${brand.primaryHex}`,
                padding: "12px 16px",
                fontFamily:
                  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                fontSize: "15px",
                lineHeight: "22px",
                color: "#1F2937",
              }}
            >
              {block.text}
            </td>
          </tr>
        </table>
      );
    case "code":
      return (
        <table
          role="presentation"
          width="100%"
          cellPadding="0"
          cellSpacing="0"
          {...({ border: "0" } as Record<string, string>)}
          style={{ margin: "0 0 16px" }}
        >
          <tr>
            <td
              style={{
                backgroundColor: "#F3F4F6",
                border: "1px solid #E5E7EB",
                borderRadius: "6px",
                padding: "16px",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                fontSize: "14px",
                lineHeight: "20px",
                color: "#1F2937",
                wordBreak: "break-all",
              }}
            >
              {block.text}
            </td>
          </tr>
        </table>
      );
    case "divider":
      return (
        <table
          role="presentation"
          width="100%"
          cellPadding="0"
          cellSpacing="0"
          {...({ border: "0" } as Record<string, string>)}
          style={{ margin: "16px 0" }}
        >
          <tr>
            <td
              style={{
                borderTop: "1px solid #E5E7EB",
                fontSize: "1px",
                lineHeight: "1px",
              }}
            >
              &nbsp;
            </td>
          </tr>
        </table>
      );
  }
}

function MetadataTable({ rows }: { rows: MetadataRow[] }): JSX.Element {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding="0"
      cellSpacing="0"
      {...({ border: "0" } as Record<string, string>)}
      style={{
        margin: "0 0 24px",
        borderTop: "1px solid #E5E7EB",
      }}
    >
      {rows.map((row) => (
        <tr>
          <td
            style={{
              padding: "12px 0",
              borderBottom: "1px solid #E5E7EB",
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
              fontSize: "14px",
              lineHeight: "20px",
              color: "#4B5563",
              width: "40%",
              verticalAlign: "top",
            }}
          >
            {row.label}
          </td>
          <td
            style={{
              padding: "12px 0",
              borderBottom: "1px solid #E5E7EB",
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
              fontSize: "14px",
              lineHeight: "20px",
              color: "#1F2937",
              fontWeight: row.emphasis ? "700" : "400",
              textAlign: "right",
              verticalAlign: "top",
            }}
          >
            {row.value}
          </td>
        </tr>
      ))}
    </table>
  );
}

/**
 * Bulletproof button — VML for classic Outlook (Word renderer), <a> for
 * everyone else. We render the surrounding table via JSX and inject the
 * MSO conditional + anchor via dangerouslySetInnerHTML so we can include
 * the raw `<!--[if mso]>` markers Preact would otherwise eat.
 */
function Button({
  cta,
  brand,
}: {
  cta: EmailCta;
  brand: BrandAssets;
}): JSX.Element {
  const href = cta.url;
  const label = cta.label;
  const fillHex = brand.primaryHex;

  const html = `
<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:24px auto;">
  <tr>
    <td align="center" bgcolor="${fillHex}" style="border-radius:6px;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                   href="${
    escapeHtml(href)
  }" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="13%"
                   strokecolor="${fillHex}" fillcolor="${fillHex}">
        <w:anchorlock/>
        <center style="color:#FFFFFF;font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:600;">${
    escapeHtml(label)
  }</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
      <a href="${escapeHtml(href)}" target="_blank"
         style="background-color:${fillHex};border:1px solid ${fillHex};border-radius:6px;color:#FFFFFF;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:48px;text-align:center;text-decoration:none;width:280px;-webkit-text-size-adjust:none;mso-hide:all;">
        ${escapeHtml(label)}
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;

  // deno-lint-ignore react-no-danger
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function Footer({
  brand,
  footerNote,
}: {
  brand: BrandAssets;
  footerNote?: string;
}): JSX.Element {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding="0"
      cellSpacing="0"
      {...({ border: "0" } as Record<string, string>)}
      style={{ marginTop: "24px" }}
    >
      {footerNote && (
        <tr>
          <td
            align="center"
            style={{
              padding: "0 16px 16px",
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
              fontSize: "13px",
              lineHeight: "18px",
              color: "#4B5563",
            }}
          >
            {footerNote}
          </td>
        </tr>
      )}
      <tr>
        <td
          align="center"
          style={{
            padding: "16px",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            fontSize: "12px",
            lineHeight: "18px",
            color: "#6B7280",
          }}
        >
          <strong style={{ color: "#1F2937" }}>{brand.wordmark}</strong>
          <br />
          <a
            href="mailto:support@polaris.express"
            style={{ color: "#6B7280", textDecoration: "underline" }}
          >
            support@polaris.express
          </a>
        </td>
      </tr>
    </table>
  );
}

function Card({ children }: { children: ComponentChildren }): JSX.Element {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding="0"
      cellSpacing="0"
      {...({ border: "0" } as Record<string, string>)}
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #E5E7EB",
        borderRadius: "8px",
      }}
    >
      <tr>
        <td style={{ padding: "32px 24px" }}>{children}</td>
      </tr>
    </table>
  );
}

function Layout({ spec, brand }: LayoutProps): JSX.Element {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding="0"
      cellSpacing="0"
      {...({ border: "0" } as Record<string, string>)}
      style={{ backgroundColor: "#F4F1EC" }}
    >
      <tr>
        <td align="center" style={{ padding: "0 16px 32px" }}>
          <table
            role="presentation"
            width="600"
            cellPadding="0"
            cellSpacing="0"
            {...({ border: "0" } as Record<string, string>)}
            style={{ width: "600px", maxWidth: "100%" }}
          >
            <tr>
              <td>
                <Header brand={brand} />
              </td>
            </tr>
            <tr>
              <td>
                <Card>
                  <Title text={spec.title} />
                  {spec.body.map((block) => (
                    <Block block={block} brand={brand} />
                  ))}
                  {spec.metadata && spec.metadata.length > 0 && (
                    <MetadataTable rows={spec.metadata} />
                  )}
                  {spec.cta && <Button cta={spec.cta} brand={brand} />}
                </Card>
              </td>
            </tr>
            <tr>
              <td>
                <Footer brand={brand} footerNote={spec.footerNote} />
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  );
}

// ---- Document wrapper -----------------------------------------------------

/** Build the global `<style>` block. juice will inline most of these onto
 *  elements, but `@media` and `prefers-color-scheme` overrides have to stay
 *  inside the head — juice preserves @-rules.
 */
function buildStyleBlock(brand: BrandAssets): string {
  return `
  /* Client resets */
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
  body { margin:0 !important; padding:0 !important; width:100% !important; background-color:#F4F1EC; }

  /* Mobile */
  @media screen and (max-width: 600px) {
    .container { width: 100% !important; }
    h1 { font-size: 22px !important; line-height: 28px !important; }
  }

  /* Dark-mode honoring clients (Apple Mail, Outlook.com web) */
  @media (prefers-color-scheme: dark) {
    body { background-color: #111827 !important; }
    .card { background-color: #1F2937 !important; border-color: #374151 !important; }
    .text-primary { color: #F3F4F6 !important; }
    .text-secondary { color: #9CA3AF !important; }
    .brand-accent { color: ${brand.primaryDark} !important; }
  }

  /* Outlook.com web dark mode */
  [data-ogsc] body { background-color: #111827 !important; }
  [data-ogsc] .card { background-color: #1F2937 !important; border-color: #374151 !important; }
  [data-ogsc] .text-primary { color: #F3F4F6 !important; }
  [data-ogsc] .text-secondary { color: #9CA3AF !important; }
  [data-ogsc] .brand-accent { color: ${brand.primaryDark} !important; }
`;
}

function wrapDocument(
  inner: string,
  styleBlock: string,
  preheaderHtml: string,
  brand: BrandAssets,
): string {
  // MSO conditionals + meta tags belong outside the JSX (Preact strips
  // unrecognised hosts and would mangle <!--[if mso]>).
  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(brand.name)}</title>
<!--[if mso]>
<noscript>
  <xml>
    <o:OfficeDocumentSettings>
      <o:PixelsPerInch>96</o:PixelsPerInch>
      <o:AllowPNG/>
    </o:OfficeDocumentSettings>
  </xml>
</noscript>
<style>
  table, td, div, h1, p { font-family: 'Segoe UI', Arial, sans-serif !important; }
</style>
<![endif]-->
<style>${styleBlock}</style>
</head>
<body>
${preheaderHtml}
${inner}
</body>
</html>`;
}

// ---- Plain-text reducer ---------------------------------------------------

function blockToText(block: EmailBlock): string {
  switch (block.type) {
    case "paragraph":
      return block.text;
    case "highlight":
      return `> ${block.text}`;
    case "code":
      return block.text;
    case "divider":
      return "---";
  }
}

function metadataToText(rows: MetadataRow[]): string {
  return rows.map((r) => `${r.label}: ${r.value}`).join("\r\n");
}

function buildText(spec: EmailTemplate, brand: BrandAssets): string {
  const lines: string[] = [];
  lines.push(spec.title);
  lines.push("");
  for (const block of spec.body) {
    lines.push(blockToText(block));
    lines.push("");
  }
  if (spec.metadata && spec.metadata.length > 0) {
    lines.push(metadataToText(spec.metadata));
    lines.push("");
  }
  if (spec.cta) {
    lines.push(`${spec.cta.label}: ${spec.cta.url}`);
    lines.push("");
  }
  if (spec.footerNote) {
    lines.push(spec.footerNote);
    lines.push("");
  }
  lines.push("--");
  lines.push(brand.wordmark);
  lines.push("support@polaris.express");
  return lines.join("\r\n");
}

// ---- Entry point ----------------------------------------------------------

export async function renderTemplate(
  spec: EmailTemplate,
): Promise<RenderedEmail> {
  validateSpec(spec);
  const brand = BRAND_ASSETS[spec.brand];

  // 1. Render the JSX body (everything inside <body> sans the preheader).
  const inner = renderToString(<Layout spec={spec} brand={brand} />);

  // 2. Render the preheader separately so we can keep it as the very first
  //    element after <body> (clients sample text from the top).
  const preheaderHtml = renderToString(<Preheader text={spec.preheader} />);

  // 3. Compose the full document with style block + MSO conditionals.
  const rawHtml = wrapDocument(
    inner,
    buildStyleBlock(brand),
    preheaderHtml,
    brand,
  );

  // 4. Inline the styles. juice converts the <style> block into inline
  //    `style=""` attributes on matching elements while preserving @-rules.
  //    Lazy-loaded — see top of file for why.
  let html: string;
  try {
    const juice = await getJuice();
    html = juice(rawHtml, {
      preserveImportant: true,
      preserveMediaQueries: true,
      preserveFontFaces: true,
      removeStyleTags: false,
    });
  } catch (err) {
    throw new Error(
      `Email render: juice failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const text = buildText(spec, brand);

  return {
    subject: spec.subject,
    preheader: spec.preheader,
    html,
    text,
    fromHeader: brand.fromHeader,
    replyTo: brand.replyTo,
    category: spec.category,
  };
}
