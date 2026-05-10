/**
 * Connector glyph components — small SVG silhouettes that visually
 * mirror the iOS Canvas drawings in `ExpresScan/App/Design/Components`.
 *
 * Use via `<ConnectorSpec />` (in `components/shared/`); only reach
 * for the individual glyph if you specifically don't want the kW +
 * label that ConnectorSpec composes.
 */

export { J1772Glyph } from "./J1772Glyph.tsx";
export { NacsGlyph } from "./NacsGlyph.tsx";
export { CcsGlyph } from "./CcsGlyph.tsx";
export { ChademoGlyph } from "./ChademoGlyph.tsx";
export { Type2Glyph } from "./Type2Glyph.tsx";

import type { ComponentChildren } from "preact";
import { CcsGlyph } from "./CcsGlyph.tsx";
import { ChademoGlyph } from "./ChademoGlyph.tsx";
import { J1772Glyph } from "./J1772Glyph.tsx";
import { NacsGlyph } from "./NacsGlyph.tsx";
import { Type2Glyph } from "./Type2Glyph.tsx";

/** The five connector types we render glyphs for. Matches the
 *  `connector_type_override` CHECK in `chargers`. */
export type ConnectorType = "ccs" | "j1772" | "nacs" | "chademo" | "type2";

/**
 * Returns the glyph component for a given connector type, or `null` if
 * the type is unknown — call sites should fall back to a label-only
 * rendering when this returns `null`.
 */
export function connectorGlyphFor(
  type: ConnectorType | null | undefined,
):
  | ((props: {
    size?: number;
    color?: string;
    class?: string;
    "aria-label"?: string;
  }) => ComponentChildren)
  | null {
  switch (type) {
    case "j1772":
      return J1772Glyph;
    case "nacs":
      return NacsGlyph;
    case "ccs":
      return CcsGlyph;
    case "chademo":
      return ChademoGlyph;
    case "type2":
      return Type2Glyph;
    default:
      return null;
  }
}

export const CONNECTOR_TYPE_LABEL: Record<ConnectorType, string> = {
  ccs: "CCS",
  j1772: "J1772",
  nacs: "NACS",
  chademo: "CHAdeMO",
  type2: "Type 2",
};
