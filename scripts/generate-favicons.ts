#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Favicon generation script for ExpresSync.
 *
 * Converts static/logo.svg into PNG favicons at multiple sizes using
 * ImageMagick's `convert` command. Run manually whenever the logo changes:
 *
 *   deno run --allow-read --allow-write --allow-run scripts/generate-favicons.ts
 *
 * Prerequisites: ImageMagick must be installed and `convert` on PATH
 * (e.g., `brew install imagemagick` or `apt install imagemagick`).
 */

const sizes = [16, 32, 48, 180, 192, 512];

for (const size of sizes) {
  const outName = size === 180 ? "apple-touch-icon.png" : `favicon-${size}.png`;
  const cmd = new Deno.Command("convert", {
    args: [
      "-background",
      "none",
      "-resize",
      `${size}x${size}`,
      "static/logo.svg",
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
