#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Favicon + native app-icon generator for ExpressCharge.
 *
 * Outputs three families:
 *
 *   1. Web favicons (under static/) — see top of `WEB_JOBS`. Powers the
 *      <link rel="icon"> set in routes/_app.tsx and the PWA manifests.
 *
 *   2. iOS App Icon set (under app-icons/ios/AppIcon.appiconset/) — every
 *      size Xcode requests for an iPhone + iPad app, plus the 1024×1024
 *      App Store marketing icon. Drag-drop the generated `.appiconset`
 *      folder into Xcode's asset catalog.
 *
 *   3. Android launcher icons (under app-icons/android/) — both the
 *      legacy `mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png` square icons
 *      and the adaptive-icon foreground/background layers required by
 *      Android 8+ (`ic_launcher_foreground.png` + `ic_launcher_background.png`
 *      at the same density buckets), plus the 512×512 Play Store icon.
 *
 * Sources (all under static/):
 *   logo.svg            — favicon glyph: navy thunderbolt for max
 *                          legibility at 16/32/48px tab-bar sizes.
 *   logo-app.svg        — app-icon glyph: white thunderbolt with cyan
 *                          glow + lucide rounded joins. Used everywhere
 *                          the icon shows as an app launcher (iOS home,
 *                          Android legacy, App Store / Play Store, PWA
 *                          "any" icons).
 *   logo-maskable.svg   — full-bleed gradient with glyph in 80% safe zone;
 *                          PWA "maskable" purpose icons.
 *   logo-foreground.svg — Android adaptive-icon foreground (transparent
 *                          background, glyph in safe zone).
 *   logo-background.svg — Android adaptive-icon background (full-bleed
 *                          gradient, no glyph).
 *
 * Run whenever any of the source SVGs change:
 *   deno run --allow-read --allow-write --allow-run \
 *     scripts/generate-favicons.ts
 *
 * Prerequisites: ImageMagick on PATH (`convert`).
 */

const STATIC = "static";
const IOS = "app-icons/ios/AppIcon.appiconset";
const ANDROID = "app-icons/android";

interface Job {
  src: string;
  out: string;
  size: number;
}

// --- Web favicons ---------------------------------------------------------
// Tab-bar favicons stay on logo.svg (navy bolt) for max legibility at small
// sizes. Anything that shows as an app launcher icon (apple-touch, manifest
// "any" icons) renders from logo-app.svg (white bolt + cyan glow).
const WEB_JOBS: Job[] = [
  { src: "logo.svg", out: `${STATIC}/favicon-16.png`, size: 16 },
  { src: "logo.svg", out: `${STATIC}/favicon-32.png`, size: 32 },
  { src: "logo.svg", out: `${STATIC}/favicon-48.png`, size: 48 },
  { src: "logo.svg", out: `${STATIC}/favicon-96.png`, size: 96 },
  { src: "logo-app.svg", out: `${STATIC}/apple-touch-icon.png`, size: 180 },
  { src: "logo-app.svg", out: `${STATIC}/icon-192.png`, size: 192 },
  { src: "logo-app.svg", out: `${STATIC}/icon-512.png`, size: 512 },
  {
    src: "logo-maskable.svg",
    out: `${STATIC}/icon-maskable-192.png`,
    size: 192,
  },
  {
    src: "logo-maskable.svg",
    out: `${STATIC}/icon-maskable-512.png`,
    size: 512,
  },
];

// --- iOS App Icon set -----------------------------------------------------
// Names match Apple's actool conventions so Xcode's "drag-drop the
// .appiconset folder" workflow lights them up automatically. The
// generated Contents.json below maps each filename to its idiom/scale.
interface IosEntry {
  size: number;
  filename: string;
  // For Contents.json:
  idiom: "iphone" | "ipad" | "ios-marketing";
  iconSize: string; // e.g. "20x20"
  scale: string; // e.g. "2x"
}
const IOS_ENTRIES: IosEntry[] = [
  // iPhone
  {
    size: 40,
    filename: "Icon-20@2x.png",
    idiom: "iphone",
    iconSize: "20x20",
    scale: "2x",
  },
  {
    size: 60,
    filename: "Icon-20@3x.png",
    idiom: "iphone",
    iconSize: "20x20",
    scale: "3x",
  },
  {
    size: 58,
    filename: "Icon-29@2x.png",
    idiom: "iphone",
    iconSize: "29x29",
    scale: "2x",
  },
  {
    size: 87,
    filename: "Icon-29@3x.png",
    idiom: "iphone",
    iconSize: "29x29",
    scale: "3x",
  },
  {
    size: 80,
    filename: "Icon-40@2x.png",
    idiom: "iphone",
    iconSize: "40x40",
    scale: "2x",
  },
  {
    size: 120,
    filename: "Icon-40@3x.png",
    idiom: "iphone",
    iconSize: "40x40",
    scale: "3x",
  },
  {
    size: 120,
    filename: "Icon-60@2x.png",
    idiom: "iphone",
    iconSize: "60x60",
    scale: "2x",
  },
  {
    size: 180,
    filename: "Icon-60@3x.png",
    idiom: "iphone",
    iconSize: "60x60",
    scale: "3x",
  },
  // iPad
  {
    size: 20,
    filename: "Icon-20.png",
    idiom: "ipad",
    iconSize: "20x20",
    scale: "1x",
  },
  {
    size: 40,
    filename: "Icon-20@2x-ipad.png",
    idiom: "ipad",
    iconSize: "20x20",
    scale: "2x",
  },
  {
    size: 29,
    filename: "Icon-29.png",
    idiom: "ipad",
    iconSize: "29x29",
    scale: "1x",
  },
  {
    size: 58,
    filename: "Icon-29@2x-ipad.png",
    idiom: "ipad",
    iconSize: "29x29",
    scale: "2x",
  },
  {
    size: 40,
    filename: "Icon-40.png",
    idiom: "ipad",
    iconSize: "40x40",
    scale: "1x",
  },
  {
    size: 80,
    filename: "Icon-40@2x-ipad.png",
    idiom: "ipad",
    iconSize: "40x40",
    scale: "2x",
  },
  {
    size: 152,
    filename: "Icon-76@2x.png",
    idiom: "ipad",
    iconSize: "76x76",
    scale: "2x",
  },
  {
    size: 167,
    filename: "Icon-83.5@2x.png",
    idiom: "ipad",
    iconSize: "83.5x83.5",
    scale: "2x",
  },
  // App Store
  {
    size: 1024,
    filename: "Icon-1024.png",
    idiom: "ios-marketing",
    iconSize: "1024x1024",
    scale: "1x",
  },
];

// --- Android launcher + adaptive icons ------------------------------------
interface AndroidDensity {
  // Folder suffix (mdpi / hdpi / etc).
  density: "mdpi" | "hdpi" | "xhdpi" | "xxhdpi" | "xxxhdpi";
  // Square legacy launcher icon size in px (48dp baseline × density factor).
  legacyPx: number;
  // Adaptive layer size (108dp baseline). Android composites at 108dp; PNG
  // tools want the full 108dp × density-factor pixels per layer.
  adaptivePx: number;
}
const ANDROID_DENSITIES: AndroidDensity[] = [
  { density: "mdpi", legacyPx: 48, adaptivePx: 108 },
  { density: "hdpi", legacyPx: 72, adaptivePx: 162 },
  { density: "xhdpi", legacyPx: 96, adaptivePx: 216 },
  { density: "xxhdpi", legacyPx: 144, adaptivePx: 324 },
  { density: "xxxhdpi", legacyPx: 192, adaptivePx: 432 },
];

// Helpers ------------------------------------------------------------------
async function run(cmd: string, args: string[]): Promise<void> {
  const proc = new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await proc.output();
  if (!result.success) {
    const err = new TextDecoder().decode(result.stderr);
    throw new Error(`\`${cmd} ${args.join(" ")}\` failed: ${err}`);
  }
}

async function rasterise(
  src: string,
  out: string,
  size: number,
): Promise<void> {
  await run("convert", [
    "-background",
    "none",
    "-density",
    "1024",
    `${STATIC}/${src}`,
    "-resize",
    `${size}x${size}`,
    out,
  ]);
  console.log(`  wrote ${out}`);
}

async function ensureDir(path: string): Promise<void> {
  await Deno.mkdir(path, { recursive: true });
}

// =========================================================================
// 1. Web favicons
// =========================================================================
console.log("[web] favicons");
for (const job of WEB_JOBS) {
  await rasterise(job.src, job.out, job.size);
}
await run("convert", [
  `${STATIC}/favicon-16.png`,
  `${STATIC}/favicon-32.png`,
  `${STATIC}/favicon-48.png`,
  `${STATIC}/favicon.ico`,
]);
console.log(`  wrote ${STATIC}/favicon.ico`);
await Deno.copyFile(`${STATIC}/logo.svg`, `${STATIC}/favicon.svg`);
console.log(`  wrote ${STATIC}/favicon.svg`);

// =========================================================================
// 2. iOS App Icon set
// =========================================================================
console.log("[ios] AppIcon.appiconset");
await ensureDir(IOS);
// iOS marketing (1024) requires no transparency; render onto a solid
// background colour the same as the squircle's lightest hue to be safe.
// All other iOS sizes can keep transparent corners — iOS masks them anyway
// since iOS 7. We use logo-app.svg (white bolt + cyan glow + lucide
// rounded joins) so the visual matches the home-screen launcher rendering.
for (const entry of IOS_ENTRIES) {
  const out = `${IOS}/${entry.filename}`;
  if (entry.idiom === "ios-marketing") {
    // Marketing icon: no alpha allowed by App Store. Flatten on the
    // gradient's mid-tone so any anti-aliased corner pixels resolve to
    // brand colour rather than white.
    await run("convert", [
      "-background",
      "#06b6d4",
      "-density",
      "1024",
      `${STATIC}/logo-app.svg`,
      "-resize",
      `${entry.size}x${entry.size}`,
      "-alpha",
      "remove",
      "-alpha",
      "off",
      out,
    ]);
    console.log(`  wrote ${out}`);
  } else {
    await rasterise("logo-app.svg", out, entry.size);
  }
}
// Contents.json for Xcode.
const contents = {
  images: IOS_ENTRIES.map((e) => ({
    size: e.iconSize,
    idiom: e.idiom,
    filename: e.filename,
    scale: e.scale,
  })),
  info: { version: 1, author: "xcode" },
};
await Deno.writeTextFile(
  `${IOS}/Contents.json`,
  JSON.stringify(contents, null, 2) + "\n",
);
console.log(`  wrote ${IOS}/Contents.json`);

// =========================================================================
// 3. Android launcher + adaptive icons
// =========================================================================
console.log("[android] mipmap + adaptive icons");
for (const d of ANDROID_DENSITIES) {
  const dir = `${ANDROID}/mipmap-${d.density}`;
  await ensureDir(dir);
  // Legacy square launcher icon (pre-Android 8). Uses the app-icon glyph
  // so pre-adaptive-icon devices match the post-adaptive rendering.
  await rasterise("logo-app.svg", `${dir}/ic_launcher.png`, d.legacyPx);
  // Adaptive icon layers (Android 8+). Same density bucket, larger canvas
  // (108dp instead of 48dp) since the system mask shrinks visible content.
  await rasterise(
    "logo-foreground.svg",
    `${dir}/ic_launcher_foreground.png`,
    d.adaptivePx,
  );
  await rasterise(
    "logo-background.svg",
    `${dir}/ic_launcher_background.png`,
    d.adaptivePx,
  );
}
// Play Store listing icon (512×512, no transparency).
await ensureDir(ANDROID);
await run("convert", [
  "-background",
  "#06b6d4",
  "-density",
  "1024",
  `${STATIC}/logo-app.svg`,
  "-resize",
  "512x512",
  "-alpha",
  "remove",
  "-alpha",
  "off",
  `${ANDROID}/play-store-512.png`,
]);
console.log(`  wrote ${ANDROID}/play-store-512.png`);
// Adaptive-icon XML descriptor — drop into res/mipmap-anydpi-v26/ic_launcher.xml.
const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
const xmlDir = `${ANDROID}/mipmap-anydpi-v26`;
await ensureDir(xmlDir);
await Deno.writeTextFile(`${xmlDir}/ic_launcher.xml`, adaptiveXml);
console.log(`  wrote ${xmlDir}/ic_launcher.xml`);

// --- Cleanup of legacy filenames -----------------------------------------
for (const stale of ["favicon-192.png", "favicon-512.png"]) {
  try {
    await Deno.remove(`${STATIC}/${stale}`);
    console.log(`  removed stale ${STATIC}/${stale}`);
  } catch (_e) {
    // missing is fine
  }
}

console.log("done.");
