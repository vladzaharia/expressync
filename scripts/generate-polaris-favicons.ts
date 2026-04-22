#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Polaris Express favicon generator.
 *
 * Mirrors `scripts/generate-favicons.ts` but operates on `polaris-logo.svg`
 * and writes parallel `polaris-favicon-*.png` files. Used by Track A-Shell
 * to populate the customer-surface PWA / favicon set.
 *
 * Run manually whenever the Polaris glyph changes:
 *
 *   deno run --allow-read --allow-write --allow-run \
 *     scripts/generate-polaris-favicons.ts
 *
 * Prerequisites: ImageMagick must be installed and `convert` on PATH
 * (e.g., `brew install imagemagick` or `apt install imagemagick`).
 *
 * TODO(Track J): replace the source SVG with the production Polaris
 * artwork — the current glyph is a stand-in matching the inline
 * `PolarisExpressBrand` star.
 */

const sizes = [16, 32, 48, 192, 512];

for (const size of sizes) {
  const outName = `polaris-favicon-${size}.png`;
  const cmd = new Deno.Command("convert", {
    args: [
      "-background",
      "none",
      "-resize",
      `${size}x${size}`,
      "static/polaris-logo.svg",
      `static/${outName}`,
    ],
  });

  try {
    const result = await cmd.output();
    if (!result.success) {
      console.error(
        `Failed to generate ${outName}. Install ImageMagick (e.g., brew install imagemagick or apt install imagemagick).`,
      );
      Deno.exit(1);
    }
    console.log(`Wrote static/${outName}`);
  } catch (_e) {
    console.error(
      `Failed to spawn \`convert\` for ${outName}. Install ImageMagick (e.g., brew install imagemagick or apt install imagemagick).`,
    );
    Deno.exit(1);
  }
}
