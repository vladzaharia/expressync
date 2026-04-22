import type { ComponentType } from "preact";
import type { FormFactor } from "@/src/lib/types/steve.ts";
import { type ChargerIconProps, WallboxIcon } from "./WallboxIcon.tsx";
import { PulsarIcon } from "./PulsarIcon.tsx";
import { CommanderIcon } from "./CommanderIcon.tsx";
import { WallMountIcon } from "./WallMountIcon.tsx";
import { GenericChargerIcon } from "./GenericChargerIcon.tsx";

export type { ChargerIconProps };
export {
  CommanderIcon,
  GenericChargerIcon,
  PulsarIcon,
  WallboxIcon,
  WallMountIcon,
};

/**
 * Map from DB `form_factor` column value → matching SVG icon component.
 *
 * Falls back to `GenericChargerIcon` for any unknown value at the caller
 * site (`chargerFormFactorIcons[factor] ?? GenericChargerIcon`).
 */
export const chargerFormFactorIcons: Record<
  FormFactor,
  ComponentType<ChargerIconProps>
> = {
  wallbox: WallboxIcon,
  pulsar: PulsarIcon,
  commander: CommanderIcon,
  wall_mount: WallMountIcon,
  generic: GenericChargerIcon,
};

export { type FormFactor };
