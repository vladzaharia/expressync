/**
 * PublicIdDisplay — renders an 8-char public ID as two stacked rows
 * of 4 monospaced characters, with letters in green and digits in
 * blue. Matches the iOS `PublicIdView` and the eventual sticker
 * print layout, so the same code reads identically on screen and
 * card.
 *
 * Display-only by default; set `interactive` for the
 * `PublicIdQrPopover` wrapping. The colour scheme (green letters,
 * blue digits) is intentionally fixed regardless of accent — the
 * public ID is a brand affordance, not a page-tinted element.
 */

import { cn } from "@/src/lib/utils/cn.ts";
import {
  PUBLIC_ID_GROUP_SIZE,
  splitPublicId,
} from "@/src/lib/utils/public-id.ts";

interface PublicIdDisplayProps {
  publicId: string;
  size?: "sm" | "md" | "lg";
  /** Mark the layout as interactive (used by PublicIdQrPopover to
   *  size the trigger correctly without changing visuals). */
  interactive?: boolean;
  class?: string;
}

const SIZE_CLASSES = {
  sm: "text-xs gap-x-1 gap-y-0.5",
  md: "text-base gap-x-1.5 gap-y-0.5",
  lg: "text-2xl gap-x-2 gap-y-1",
} as const;

const CHAR_CLASS = "tabular-nums leading-none";
const DIGIT_CLASS = "text-blue-500 dark:text-blue-400";
const LETTER_CLASS = "text-emerald-500 dark:text-emerald-400";

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

export function PublicIdDisplay({
  publicId,
  size = "md",
  interactive = false,
  class: className,
}: PublicIdDisplayProps) {
  const [a, b] = splitPublicId(publicId);

  return (
    <div
      class={cn(
        "inline-flex flex-col items-center font-mono font-semibold tracking-[0.2em]",
        SIZE_CLASSES[size],
        interactive && "cursor-pointer select-none",
        className,
      )}
      aria-label={`Public ID ${a}-${b}`}
    >
      <Row chars={a} />
      <Row chars={b} />
    </div>
  );
}

function Row({ chars }: { chars: string }) {
  return (
    <div class="flex">
      {Array.from(chars).map((ch, i) => (
        <span
          key={i}
          class={cn(
            CHAR_CLASS,
            isDigit(ch) ? DIGIT_CLASS : LETTER_CLASS,
            // Even spacing inside each 4-char group.
            i < PUBLIC_ID_GROUP_SIZE - 1 && "mr-[0.2em]",
          )}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}
