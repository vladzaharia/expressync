/**
 * Polaris Track E — smoke tests for `PairingCodeDisplay`.
 *
 * Pure presentational component, so a server render + string assertion is
 * enough to catch regressions in the structure (the customer login flow
 * relies on these classes/text being present so the user can read the
 * pairing code).
 */

import { assert, assertStringIncludes } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { h } from "preact";
import { PairingCodeDisplay } from "./PairingCodeDisplay.tsx";

Deno.test("PairingCodeDisplay renders the pairing code in big mono text", () => {
  const html = renderToString(
    h(PairingCodeDisplay, {
      pairingCode: "ABC123XYZ",
      secondsRemaining: 90,
    }),
  );
  assertStringIncludes(html, "ABC123XYZ");
  assertStringIncludes(html, "font-mono");
  assertStringIncludes(html, "tracking-widest");
  assertStringIncludes(html, "Pairing expires in");
  assertStringIncludes(html, "90s");
});

Deno.test("PairingCodeDisplay shows the bound charger name when provided", () => {
  const html = renderToString(
    h(PairingCodeDisplay, {
      pairingCode: "XX",
      secondsRemaining: 42,
      chargerName: "Garage",
    }),
  );
  assertStringIncludes(html, "Garage");
  assertStringIncludes(html, "Tap your card on");
  assertStringIncludes(html, "42s");
});

Deno.test("PairingCodeDisplay clamps negative seconds to 0", () => {
  const html = renderToString(
    h(PairingCodeDisplay, {
      pairingCode: "ZZ",
      secondsRemaining: -5,
    }),
  );
  assertStringIncludes(html, "0s");
});

Deno.test("PairingCodeDisplay omits BorderBeam when noBeam=true", () => {
  const withBeam = renderToString(
    h(PairingCodeDisplay, {
      pairingCode: "PP",
      secondsRemaining: 10,
    }),
  );
  const withoutBeam = renderToString(
    h(PairingCodeDisplay, {
      pairingCode: "PP",
      secondsRemaining: 10,
      noBeam: true,
    }),
  );
  // The BorderBeam component renders with a `pointer-events-none` div; the
  // assertion is a coarse "with-beam markup has more nodes than without".
  assert(
    withBeam.length > withoutBeam.length,
    "expected `noBeam=true` to drop BorderBeam markup",
  );
});
