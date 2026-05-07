/**
 * PublicIdQrPopover — wraps `PublicIdDisplay` in a clickable popover
 * that surfaces the QR code an admin would print on the sticker.
 *
 * The QR encodes the public sticker URL (`/c/<publicId>` for chargers,
 * `/u/<publicId>` for users) so what's rendered here is exactly what
 * the printed sticker would carry.
 *
 * QR generation is fully client-side: the popover lazy-loads the
 * `qrcode` npm lib on first open and rasterises into a canvas. No
 * server round-trip, no auth, no cache concerns — and the
 * `/api/admin/qr` endpoint is no longer reachable from the popover.
 */

import { useEffect, useRef, useState } from "preact/hooks";
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
   *  `/u/<id>`). */
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
      : `${PUBLIC_HOST}/u/${publicId}`);
  const formatted = formatPublicId(publicId);
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  // Render the QR into the canvas the first time the popover opens.
  // Re-renders when the encoded URL changes (admin rotates the
  // public ID, switches between charger/user, etc).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        if (cancelled || !canvasRef.current) return;
        await QRCode.toCanvas(canvasRef.current, stickerUrl, {
          width: 224,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#000000", light: "#ffffff" },
        });
        setQrError(null);
      } catch (err) {
        if (!cancelled) {
          setQrError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, stickerUrl]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
            <canvas
              ref={canvasRef}
              width={224}
              height={224}
              aria-label={`QR code that links to ${stickerUrl}`}
              class="block rounded-md bg-white p-2"
            />
          </div>
          {qrError && (
            <div class="text-center text-xs text-rose-500">
              QR render failed: {qrError}
            </div>
          )}
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
