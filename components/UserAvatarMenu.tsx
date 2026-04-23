/**
 * Re-export of the customer-facing UserAvatarMenu island, exposed at the
 * documented `components/UserAvatarMenu.tsx` path so callers can import
 * from the established `components/` namespace. The actual island
 * implementation lives at `islands/customer/UserAvatarMenu.tsx` (Fresh
 * requires islands to live under the project's `islands/` root for hydration).
 *
 * Use this in customer top-bar layouts (mobile shell + desktop). Admin
 * surfaces continue to use `islands/UserMenu.tsx`.
 */

export { default } from "@/islands/customer/UserAvatarMenu.tsx";
