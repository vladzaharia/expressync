/**
 * ChargerIdentityStrip — thin row showing a charger's public ID and
 * connector spec next to each other, so customers can match the
 * on-screen identity to what's printed on the physical sticker.
 *
 * Used everywhere a charger is referenced in the customer portal —
 * session detail, reservation detail, the home dashboard's "next
 * reservation" card, and any list rows that benefit from spec-at-a-
 * glance.
 *
 * Renders nothing when none of the three fields are populated.
 */

import { ConnectorSpec } from "./ConnectorSpec.tsx";
import { PublicIdDisplay } from "./PublicIdDisplay.tsx";
import type { ConnectorType } from "../brand/connectors/index.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface ChargerIdentityStripProps {
  publicId: string | null;
  connectorType: ConnectorType | null;
  maxKw: number | null;
  /** Smaller / denser variant for list rows. Defaults to the
   *  detail-page sizing. */
  size?: "sm" | "md";
  class?: string;
}

export function ChargerIdentityStrip({
  publicId,
  connectorType,
  maxKw,
  size = "md",
  class: className,
}: ChargerIdentityStripProps) {
  if (!publicId && !connectorType && maxKw == null) return null;
  const idSize = size === "sm" ? "sm" : "sm";
  const specSize = size === "sm" ? "sm" : "sm";
  return (
    <div
      class={cn(
        "flex flex-wrap items-center gap-4 rounded-lg border bg-card/40 px-4 py-3",
        size === "sm" && "px-3 py-2 gap-3",
        className,
      )}
    >
      {publicId && <PublicIdDisplay publicId={publicId} size={idSize} />}
      {(connectorType || maxKw != null) && (
        <ConnectorSpec
          type={connectorType}
          kw={maxKw}
          size={specSize}
        />
      )}
    </div>
  );
}
