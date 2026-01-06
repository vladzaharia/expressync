import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { Check, CreditCard, Nfc, X } from "lucide-preact";

interface TapToAddModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTagDetected: (tagId: string) => void;
  timeout?: number; // seconds
}

type ModalState = "connecting" | "waiting" | "success" | "error";

export default function TapToAddModal({
  open,
  onOpenChange,
  onTagDetected,
  timeout = 20,
}: TapToAddModalProps) {
  const timeRemaining = useSignal(timeout);
  const modalState = useSignal<ModalState>("connecting");
  const detectedTag = useSignal<string | null>(null);
  const errorMessage = useSignal<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Progress percentage (0-100)
  const progress = useComputed(() => (timeRemaining.value / timeout) * 100);

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      // Reset state
      timeRemaining.value = timeout;
      modalState.value = "connecting";
      detectedTag.value = null;
      errorMessage.value = null;
    }
  }, [open, timeout]);

  // Start SSE connection when modal opens
  useEffect(() => {
    if (!open) return;

    const startConnection = async () => {
      // First check if the endpoint is available
      try {
        const checkResponse = await fetch(`/api/tag/detect?timeout=1`, {
          method: "HEAD",
        });
        if (checkResponse.status === 503) {
          const data = await checkResponse.json().catch(() => ({}));
          errorMessage.value = data.message || "Cannot connect to log service!";
          modalState.value = "error";
          return;
        }
      } catch {
        // If HEAD fails, try SSE anyway
      }

      const eventSource = new EventSource(`/api/tag/detect?timeout=${timeout}`);
      eventSourceRef.current = eventSource;

      eventSource.addEventListener("connected", () => {
        modalState.value = "waiting";
      });

      eventSource.addEventListener("tag-detected", (event) => {
        const data = JSON.parse(event.data);
        detectedTag.value = data.tagId;
        modalState.value = "success";
        eventSource.close();
        // Auto-close after 2 seconds
        setTimeout(() => {
          onTagDetected(data.tagId);
          onOpenChange(false);
        }, 2000);
      });

      eventSource.addEventListener("timeout", () => {
        errorMessage.value = "No tag detected within the time limit";
        modalState.value = "error";
        eventSource.close();
      });

      eventSource.onerror = () => {
        if (modalState.value === "connecting") {
          errorMessage.value = "Could not connect to tag detection service";
        } else {
          errorMessage.value = "Connection to tag detection service was lost";
        }
        modalState.value = "error";
        eventSource.close();
      };
    };

    startConnection();

    // Countdown timer
    const interval = setInterval(() => {
      if (timeRemaining.value > 0 && modalState.value === "waiting") {
        timeRemaining.value -= 1;
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [open, timeout, onTagDetected, onOpenChange]);

  // Handle retry
  const handleRetry = () => {
    // Reset state and re-trigger the effect
    timeRemaining.value = timeout;
    modalState.value = "connecting";
    detectedTag.value = null;
    errorMessage.value = null;
    // Force re-run of the effect by closing and reopening
    onOpenChange(false);
    setTimeout(() => onOpenChange(true), 100);
  };

  const handleClose = () => onOpenChange(false);

  // SVG circle properties for progress ring
  const radius = 80;
  const circumference = 2 * Math.PI * radius;

  // Determine circle and squircle colors based on state
  const isSuccess = modalState.value === "success";
  const isError = modalState.value === "error";
  const isWaiting = modalState.value === "waiting" || modalState.value === "connecting";

  // For success/error, we want a filled circle instead of progress ring
  const strokeDashoffset = isWaiting
    ? circumference - (progress.value / 100) * circumference
    : 0; // Full circle for success/error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onClose={handleClose}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="size-5 text-violet-500" />
            Tap to Add
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center py-8 gap-4">
          {/* Circular progress / filled circle */}
          <div className="relative size-48">
            <svg className="size-full -rotate-90" viewBox="0 0 200 200">
              {/* Background circle - always visible */}
              <circle
                cx="100"
                cy="100"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className={cn(
                  "transition-colors duration-300",
                  isSuccess ? "text-green-500/20" : isError ? "text-destructive/20" : "text-muted/20"
                )}
              />
              {/* Progress/filled circle */}
              <circle
                cx="100"
                cy="100"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeLinecap="round"
                className={cn(
                  "transition-all duration-500",
                  isSuccess ? "text-green-500" : isError ? "text-destructive" : "text-violet-500"
                )}
                style={{
                  strokeDasharray: circumference,
                  strokeDashoffset,
                }}
              />
              {/* Filled background for success/error states */}
              {(isSuccess || isError) && (
                <circle
                  cx="100"
                  cy="100"
                  r={radius - 4}
                  className={cn(
                    "transition-all duration-300",
                    isSuccess ? "fill-green-500/10" : "fill-destructive/10"
                  )}
                />
              )}
            </svg>

            {/* Center content - Squircle with icon */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {/* Squircle container (like the logo) */}
              <div
                className={cn(
                  "relative flex items-center justify-center overflow-hidden",
                  "rounded-[30%] shadow-lg transition-all duration-300",
                  "size-18",
                  isSuccess && "bg-gradient-to-br from-green-500 via-green-400 to-green-500",
                  isError && "bg-gradient-to-br from-destructive via-red-400 to-destructive",
                  isWaiting && "bg-gradient-to-br from-primary via-accent to-primary animate-gradient"
                )}
                style={{ backgroundSize: "200% 200%" }}
              >
                {/* Icon inside squircle */}
                {isSuccess ? (
                  <Check className="size-10 text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                ) : isError ? (
                  <X className="size-10 text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                ) : (
                  <Nfc className="size-10 text-primary-foreground drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                )}
              </div>

              {/* Timer below squircle (only when waiting) */}
              {isWaiting && (
                <span className="mt-3 text-2xl font-bold tabular-nums text-muted-foreground">
                  {timeRemaining.value}s
                </span>
              )}
            </div>
          </div>

          {/* Message below the circle */}
          <div className="text-center">
            {isSuccess && detectedTag.value && (
              <>
                <p className="text-md font-semibold text-green-600 dark:text-green-400">
                  Tag Detected!
                </p>
                <p className="font-mono text-sm text-muted-foreground mt-1">
                  {detectedTag.value}
                </p>
              </>
            )}
            {isError && errorMessage.value && (
              <p className="text-md text-destructive max-w-xs">
                {errorMessage.value}
              </p>
            )}
            {isWaiting && (
              <p className="text-md text-muted-foreground">
                {modalState.value === "connecting" ? "Connecting..." : "Hold your RFID card to the charger"}
              </p>
            )}
          </div>
        </div>

        {/* Footer - only show "Try again" on error */}
        {isError && (
          <div className="flex justify-center">
            <Button onClick={handleRetry}>
              Try again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
