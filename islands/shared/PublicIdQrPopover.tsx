/**
 * PublicIdQrPopover — wraps `PublicIdDisplay` in a clickable popover
 * that surfaces the QR code an admin would print on the sticker.
 *
 * The QR encodes the public sticker URL (`/c/<publicId>` for chargers,
 * `/user/<publicId>` for users) so what's rendered here is exactly
 * what the printed sticker would carry. Source of the SVG is the
 * server-side `/api/admin/qr` endpoint, which is admin-gated by
 * middleware — non-admin viewers never reach this island, and
 * non-admin visitors of the public landing pages see the
 * `PublicIdDisplay` directly without a popover (set
 * `interactive={false}` on those surfaces).
 */

import { useEffect, useState } from "preact/hooks";
import { Copy } from "lucide-preact";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import { Button } from "@/components/ui/button.tsx";
import { PublicIdDisplay } from "@/components/shared/PublicIdDisplay.tsx";
import { formatPublicId } from "@/src/lib/utils/public-id.ts";

export type PublicIdQrEntity = "charger" | "user";

interface PublicIdQrPopoverProps {
  entity: PublicIdQrEntity;
  publicId: string;
  /** Override the URL the QR encodes. Defaults to the canonical
   *  sticker URL for the entity (`https://example.com/c/<id>` or
   *  `/user/<id>`). */
  url?: string;
  /** Display size for the trigger. Defaults to `md`. */
  size?: "sm" | "md" | "lg";
}

const PUBLIC_HOST = "https://example.com";

export default function PublicIdQrPopover({
  entity,
  publicId,
  url,
  size = "md",
}: PublicIdQrPopoverProps) {
  const stickerUrl = url ??
    (entity === "charger"
      ? `${PUBLIC_HOST}/c/${publicId}`
      : `${PUBLIC_HOST}/user/${publicId}`);
  const qrSrc = `/api/admin/qr?value=${
    encodeURIComponent(stickerUrl)
  }&size=256`;
  const formatted = formatPublicId(publicId);

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        class="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Show QR code for ${formatted}`}
      >
        <PublicIdDisplay
          publicId={publicId}
          size={size}
          interactive
        />
      </PopoverTrigger>
      <PopoverContent class="w-72" align="end">
        <div class="flex flex-col gap-3">
          <div class="flex justify-center">
            {
              /* The QR is admin-only and small enough that loading it
                inline as an <img> is the simplest approach — Cache-
                Control: private, max-age=300 keeps the round-trip
                cost negligible on subsequent opens. */
            }
            <img
              src={qrSrc}
              width={224}
              height={224}
              alt={`QR code that links to ${stickerUrl}`}
              class="block bg-white rounded-md p-2"
            />
          </div>
          <div class="flex flex-col items-center gap-2">
            <PublicIdDisplay publicId={publicId} size="md" />
            <code class="text-xs text-muted-foreground break-all text-center">
              {stickerUrl}
            </code>
          </div>
          <div class="flex gap-2">
            <CopyButton label="Copy URL" value={stickerUrl} />
            <CopyButton label="Copy ID" value={publicId} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      class="flex-1"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // Clipboard access can be denied (Firefox cross-origin,
          // etc.); show no toast — the URL is still visible above.
        }
      }}
    >
      <Copy class="size-3.5" />
      {copied ? "Copied" : label}
    </Button>
  );
}
