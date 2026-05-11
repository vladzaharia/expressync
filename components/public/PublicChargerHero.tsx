/**
 * PublicChargerHero — web counterpart of iOS `ChargerHero`.
 *
 * Composes the form-factor charger glyph + connector glyph with a
 * squared cable that loops underneath both, plus a kW + connector-type
 * label hovering above the connector. Matches the iOS hero's reading
 * order (left = charger, right = connector, U-shaped cable beneath)
 * so customers see the same shape regardless of which surface they
 * landed on.
 *
 * Implementation: relative-positioned container with the two brand
 * glyph components stacked on top of a single inline `<svg>` that
 * draws the cable. Keeps each piece (charger icon, connector glyph,
 * cable) as a separate, accessible SVG instead of a single
 * foreignObject-nested mess — and the brand icon components handle
 * their own halos / colours / sizing.
 */

import {
  chargerFormFactorIcons,
  GenericChargerIcon,
} from "@/components/brand/chargers/index.ts";
import {
  CcsGlyph,
  ChademoGlyph,
  type ConnectorType,
  J1772Glyph,
  NacsGlyph,
  Type2Glyph,
} from "@/components/brand/connectors/index.ts";
import type { FormFactor } from "@/src/lib/types/steve.ts";

type Status = "available" | "charging" | "offline" | "unknown";

interface PublicChargerHeroProps {
  formFactor: FormFactor;
  connectorType: ConnectorType | null;
  maxKw: number | null;
  status: Status;
}

// Halo colours mirror iOS `ChargerStatusVisuals.tone`.
const STATUS_HALO: Record<Status, string> = {
  available: "oklch(0.72 0.18 155)", // emerald
  charging: "oklch(0.72 0.18 155)",
  offline: "oklch(0.65 0.17 25)", // rose
  unknown: "oklch(0.78 0.12 195)", // pulsar-cyan default
};

const STATUS_CABLE_COLOR: Record<Status, string> = {
  available: "oklch(0.72 0.18 155 / 0.7)",
  charging: "oklch(0.72 0.18 155 / 0.85)",
  offline: "oklch(0.55 0.02 250 / 0.5)",
  unknown: "oklch(0.78 0.12 195 / 0.7)",
};

// deno-lint-ignore no-explicit-any
const CONNECTOR_GLYPHS: Record<ConnectorType, any> = {
  ccs: CcsGlyph,
  j1772: J1772Glyph,
  nacs: NacsGlyph,
  chademo: ChademoGlyph,
  type2: Type2Glyph,
};

const CONNECTOR_LABEL: Record<ConnectorType, string> = {
  ccs: "CCS",
  j1772: "J1772",
  nacs: "NACS",
  chademo: "CHAdeMO",
  type2: "Type 2",
};

function formatKw(kw: number): string {
  if (Math.abs(kw - Math.round(kw)) < 0.05) return String(Math.round(kw));
  return kw.toFixed(1);
}

export function PublicChargerHero(
  { formFactor, connectorType, maxKw, status }: PublicChargerHeroProps,
) {
  const ChargerIcon = chargerFormFactorIcons[formFactor] ?? GenericChargerIcon;
  const ConnectorGlyph = connectorType ? CONNECTOR_GLYPHS[connectorType] : null;

  const haloColor = STATUS_HALO[status];
  const cableColor = STATUS_CABLE_COLOR[status];

  // Cable path is drawn in a fixed 480×220 coordinate system; the
  // glyphs are absolutely positioned in the same frame so they line
  // up at any responsive width.
  //
  // Endpoints: charger bottom-centre = (140, 168); connector
  // bottom-centre = (340, 160). U-bend dips to y=196.
  const cablePath = [
    "M 140 168",
    "L 140 184",
    "A 12 12 0 0 0 152 196",
    "L 328 196",
    "A 12 12 0 0 0 340 184",
    "L 340 160",
  ].join(" ");

  return (
    <div
      class="relative mx-auto w-full max-w-[480px]"
      style="aspect-ratio: 480 / 220;"
      role="img"
      aria-label={[
        `Charger status ${status}`,
        connectorType ? `${CONNECTOR_LABEL[connectorType]} connector` : null,
        maxKw != null ? `${formatKw(maxKw)} kilowatts` : null,
      ].filter(Boolean).join(", ")}
    >
      {/* Cable + strain reliefs — drawn first so glyphs sit on top. */}
      <svg
        viewBox="0 0 480 220"
        class="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <path
          d={cablePath}
          fill="none"
          stroke={cableColor}
          stroke-width={8}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d={cablePath}
          fill="none"
          stroke="white"
          stroke-opacity={0.22}
          stroke-width={3}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        {
          /* Strain-relief boots — small rounded rects at each cable
            entry point. Filled with the status halo colour at full
            opacity so they read as solid grommets. */
        }
        <rect
          x={131}
          y={164}
          width={18}
          height={10}
          rx={3}
          fill={haloColor}
        />
        <rect
          x={333}
          y={156}
          width={14}
          height={8}
          rx={3}
          fill={haloColor}
        />
      </svg>

      {
        /* Charger glyph — absolute-positioned in the same coordinate
          space as the cable. Centred at (140, 100) with 120×120 box,
          so top-left = (80, 40). */
      }
      <div
        class="absolute"
        style="left: 16.7%; top: 18.2%; width: 25%; aspect-ratio: 1;"
      >
        <ChargerIcon
          size={120}
          haloColor={haloColor}
          class="h-full w-full"
        />
      </div>

      {
        /* Connector glyph — centred at (340, 96) with 88×88 box, so
          top-left = (296, 52). */
      }
      <div
        class="absolute flex items-center justify-center text-foreground"
        style="left: 61.7%; top: 23.6%; width: 18.3%; aspect-ratio: 1;"
      >
        {ConnectorGlyph ? <ConnectorGlyph size={88} /> : (
          <div
            class="rounded-full border-[3px] border-dashed opacity-40"
            style="width: 80%; aspect-ratio: 1;"
            aria-hidden="true"
          />
        )}
      </div>

      {/* kW + label, centred above the connector glyph at (340, 26). */}
      {connectorType && (
        <div
          class="absolute flex flex-col items-center text-center"
          style="left: 56.7%; top: 0%; width: 28.3%;"
        >
          {maxKw != null && (
            <span class="text-xl font-bold leading-none text-foreground">
              {formatKw(maxKw)} kW
            </span>
          )}
          <span class="mt-0.5 text-xs font-medium text-muted-foreground">
            {CONNECTOR_LABEL[connectorType]}
          </span>
        </div>
      )}
    </div>
  );
}
