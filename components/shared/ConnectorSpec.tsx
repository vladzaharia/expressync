/**
 * ConnectorSpec — composite charger spec block (glyph + kW + label).
 *
 * Used everywhere a charger's connector type and kW need to read as
 * a single product fact: the public landing page hero, the admin
 * charger detail specs section, the customer portal session/
 * reservation rows, and the iOS app via its native equivalents.
 *
 * Inherits text colour from its parent so accent-coloured contexts
 * (e.g. a SectionCard accent="orange") tint the glyph and label
 * uniformly.
 */

import { cn } from "@/src/lib/utils/cn.ts";
import {
  CONNECTOR_TYPE_LABEL,
  connectorGlyphFor,
  type ConnectorType,
} from "@/components/brand/connectors/index.ts";

const SIZE_PX = {
  sm: 24,
  md: 40,
  lg: 72,
} as const;

const KW_TEXT_CLASS = {
  sm: "text-sm font-semibold",
  md: "text-lg font-semibold",
  lg: "text-3xl font-bold",
} as const;

const LABEL_TEXT_CLASS = {
  sm: "text-xs text-muted-foreground",
  md: "text-sm text-muted-foreground",
  lg: "text-base text-muted-foreground",
} as const;

interface ConnectorSpecProps {
  /** Connector type. `null` renders the kW + dash placeholder. */
  type: ConnectorType | null | undefined;
  /** kW rating. `null` renders a dash. */
  kw: number | null | undefined;
  /** Glyph + label sizing. */
  size?: keyof typeof SIZE_PX;
  /** Override the displayed connector label (otherwise canonical). */
  label?: string;
  /** Layout direction. `row` (default) = glyph + kW/label horizontally;
   *  `column` = glyph above kW/label, centred. */
  orientation?: "row" | "column";
  class?: string;
}

export function ConnectorSpec({
  type,
  kw,
  size = "md",
  label,
  orientation = "row",
  class: className,
}: ConnectorSpecProps) {
  const Glyph = connectorGlyphFor(type);
  const labelText = label ??
    (type ? CONNECTOR_TYPE_LABEL[type] : "Unknown");
  const kwText = kw != null ? `${kw} kW` : "—";

  return (
    <div
      class={cn(
        "inline-flex items-center gap-3",
        orientation === "column" && "flex-col items-center gap-1",
        className,
      )}
    >
      {Glyph
        ? <Glyph size={SIZE_PX[size]} aria-label={`${labelText} connector`} />
        : (
          <span
            aria-hidden
            class="inline-flex items-center justify-center rounded-full border-2 border-current text-current"
            style={{ width: SIZE_PX[size], height: SIZE_PX[size] }}
          >
            ?
          </span>
        )}
      <div
        class={cn(
          "flex flex-col leading-tight",
          orientation === "column" && "items-center text-center",
        )}
      >
        <span class={KW_TEXT_CLASS[size]}>{kwText}</span>
        <span class={LABEL_TEXT_CLASS[size]}>{labelText}</span>
      </div>
    </div>
  );
}
