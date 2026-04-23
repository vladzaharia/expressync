/**
 * CustomerProfileForm — inline edit for the customer's own name.
 *
 * Polaris Track G3 — small editable surface inside the Account page's
 * Profile SectionCard. Only `name` is editable here. Email changes are
 * admin-only per the lifecycle plan and the API rejects them with 403.
 *
 * UX:
 *   - View mode renders the current name (or "Add your name" placeholder).
 *   - Edit mode swaps to an `<Input>` with Save / Cancel buttons.
 *   - Save POSTs PUT /api/customer/profile and shows a toast on success.
 */

import { useState } from "preact/hooks";
import { toast } from "sonner";
import { Check, Loader2, Pencil, X } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";

interface Props {
  initialName: string | null;
}

export default function CustomerProfileForm({ initialName }: Props) {
  const [name, setName] = useState(initialName ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const startEdit = () => setEditing(true);
  const cancel = () => {
    setName(initialName ?? "");
    setEditing(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/customer/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        toast.error(body.error ?? `Failed to save (${res.status})`);
        return;
      }
      toast.success("Profile updated");
      setEditing(false);
    } catch {
      toast.error("Failed to save profile");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {initialName?.trim() ||
            (
              <span className="italic text-muted-foreground">
                Add your name
              </span>
            )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={startEdit}
          aria-label="Edit name"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={name}
        onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        disabled={busy}
        className="max-w-[16rem]"
        aria-label="Name"
      />
      <Button
        type="button"
        size="sm"
        onClick={save}
        disabled={busy}
        aria-label="Save name"
      >
        {busy
          ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          : <Check className="size-3.5" aria-hidden="true" />}
        Save
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={cancel}
        disabled={busy}
        aria-label="Cancel"
      >
        <X className="size-3.5" aria-hidden="true" />
        Cancel
      </Button>
    </div>
  );
}
