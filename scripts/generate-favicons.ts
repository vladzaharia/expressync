#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Favicon + app-icon generator for ExpressCharge.
 *
 * Sources:
 *   static/logo.svg          — primary glyph (squircle bleeds inside its
 *                               own canvas; used for browser favicons,
 *                               apple-touch-icon, "any"-purpose PWA icons).
 *   static/logo-maskable.svg — full-bleed gradient with the glyph in the
 *                               inner 80% safe zone; used for "maskable"-
 *                               purpose PWA icons that Android/iOS clip.
 *
 * Outputs (all under static/):
 *   favicon.svg                — copy of logo.svg (modern browsers)
 *   favicon.ico                — multi-size (16/32/48), legacy browsers
 *   favicon-16.png, -32.png,
 *     -48.png                  — classic <link rel="icon"> sizes
 *   favicon-96.png             — Chrome desktop / new-tab page
 *   apple-touch-icon.png       — 180×180, iOS home screen
 *   icon-192.png, icon-512.png — PWA manifest, "any" purpose
 *   icon-maskable-192.png,
 *     icon-maskable-512.png    — PWA manifest, "maskable" purpose
 *
 * Run whenever logo.svg or logo-maskable.svg changes:
 *   deno run --allow-read --allow-write --allow-run \
 *     scripts/generate-favicons.ts
 *
 * Prerequisites: ImageMagick on PATH (`convert`).
 */

const STATIC = "static";

interface Job {
  src: string;
  out: string;
  size: number;
}

const jobs: Job[] = [
  // --- favicon.svg-derived PNGs (browser tabs, iOS home, manifest "any") ---
  { src: "logo.svg", out: "favicon-16.png", size: 16 },
  { src: "logo.svg", out: "favicon-32.png", size: 32 },
  { src: "logo.svg", out: "favicon-48.png", size: 48 },
  { src: "logo.svg", out: "favicon-96.png", size: 96 },
  { src: "logo.svg", out: "apple-touch-icon.png", size: 180 },
  { src: "logo.svg", out: "icon-192.png", size: 192 },
  { src: "logo.svg", out: "icon-512.png", size: 512 },
  // --- maskable-source PNGs (PWA manifest "maskable" purpose) ---
  { src: "logo-maskable.svg", out: "icon-maskable-192.png", size: 192 },
  { src: "logo-maskable.svg", out: "icon-maskable-512.png", size: 512 },
];

async function run(cmd: string, args: string[]): Promise<void> {
  const proc = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" });
  const result = await proc.output();
  if (!result.success) {
    const err = new TextDecoder().decode(result.stderr);
    throw new Error(`\`${cmd} ${args.join(" ")}\` failed: ${err}`);
  }
}

// --- 1. PNGs ---------------------------------------------------------------
for (const job of jobs) {
  await run("convert", [
    "-background",
    "none",
    "-density",
    "1024",
    `${STATIC}/${job.src}`,
    "-resize",
    `${job.size}x${job.size}`,
    `${STATIC}/${job.out}`,
  ]);
  console.log(`  wrote ${STATIC}/${job.out}`);
}

// --- 2. favicon.ico (multi-size: 16, 32, 48) -------------------------------
await run("convert", [
  `${STATIC}/favicon-16.png`,
  `${STATIC}/favicon-32.png`,
  `${STATIC}/favicon-48.png`,
  `${STATIC}/favicon.ico`,
]);
console.log(`  wrote ${STATIC}/favicon.ico`);

// --- 3. favicon.svg (modern browsers — vector) -----------------------------
await Deno.copyFile(`${STATIC}/logo.svg`, `${STATIC}/favicon.svg`);
console.log(`  wrote ${STATIC}/favicon.svg`);

// --- 4. Legacy aliases removed ---------------------------------------------
// `favicon-192.png` / `favicon-512.png` are the historic names; we now use
// `icon-192.png` / `icon-512.png` to match the manifest. Drop the old names
// if they exist so we don't ship stale files.
for (const stale of ["favicon-192.png", "favicon-512.png"]) {
  try {
    await Deno.remove(`${STATIC}/${stale}`);
    console.log(`  removed stale ${STATIC}/${stale}`);
  } catch (_e) {
    // missing is fine
  }
}

console.log("done.");
