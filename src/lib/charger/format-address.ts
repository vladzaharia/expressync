/**
 * Server-side formatter for the structured address columns on
 * `chargers`. Produces a single-line string suitable for
 * Apple Maps' `?address=` URL parameter and human-readable on the
 * iOS detail screen.
 *
 * Returns `null` when no address fields are populated, so the iOS
 * Navigate button can hide itself with a single nil check rather
 * than parsing an empty string.
 */

export interface ChargerAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
}

export function formatChargerAddress(a: ChargerAddress): string | null {
  const parts: string[] = [];
  if (a.addressLine1?.trim()) parts.push(a.addressLine1.trim());
  if (a.addressLine2?.trim()) parts.push(a.addressLine2.trim());

  // City + region + postal share a line so the formatted result
  // matches how a US/CA postal address reads ("123 Main St, San
  // Francisco, CA 94110, US").
  const locality: string[] = [];
  if (a.addressCity?.trim()) locality.push(a.addressCity.trim());
  if (a.addressRegion?.trim()) locality.push(a.addressRegion.trim());
  if (a.addressPostalCode?.trim()) locality.push(a.addressPostalCode.trim());
  if (locality.length) parts.push(locality.join(" "));

  if (a.addressCountry?.trim()) parts.push(a.addressCountry.trim());

  return parts.length ? parts.join(", ") : null;
}
