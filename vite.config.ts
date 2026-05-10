import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    fresh(),
    tailwindcss(),
  ],
  ssr: {
    // `qrcode` is a CJS package whose transitive deps (`pngjs` etc.)
    // do `module.exports = …` — Vite's SSR bundler can rewrite some
    // CJS but trips on this pattern, so the bundled handler crashes
    // with `ReferenceError: module is not defined` at runtime. Marking
    // the package external keeps the runtime `import "qrcode"` so Deno
    // resolves the npm package itself, where it works fine.
    noExternal: [],
    external: ["qrcode"],
  },
});
