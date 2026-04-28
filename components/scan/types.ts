/**
 * Internal scan-state types shared by the visual primitives
 * (`ScanStateIcon`, `ScanPanel`). Decoupled from any specific state
 * machine so different scan flows can map onto the same icon set
 * without coupling.
 */

/**
 * Discriminator for which Lucide glyph to render. The shape mirrors
 * the legacy `ScanTagState` union (a state machine that's been
 * superseded by `useUnifiedScan`) so we can keep the icon mapping
 * exhaustive without dragging the whole hook along.
 */
export type ScanStateKind =
  | "idle"
  | "connecting"
  | "waiting"
  | "detected"
  | "resolving"
  | "routing"
  | "timeout"
  | "unavailable"
  | "network_error"
  | "lookup_failed"
  | "cancelled"
  | "dismissed";

/**
 * Minimum payload `ScanStateIcon` needs. Concrete callers can pass
 * richer payloads (e.g. `{ kind: "detected", idTag, ... }`); only
 * `kind` is read for icon selection. The index-signature carrier
 * keeps callers from getting "Object literal may only specify known
 * properties" warnings on extra fields.
 */
export interface ScanStateForIcon {
  kind: ScanStateKind;
  [key: string]: unknown;
}
