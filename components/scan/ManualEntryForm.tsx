/**
 * ManualEntryForm — fallback text entry for the Scan Tag modal when the
 * Docker log stream is unreachable (or the operator simply wants to type
 * the id tag). Shell is intentionally minimal: the modal supplies the
 * surrounding framing.
 */

import { useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";

interface Props {
  /** Called with a trimmed idTag when the user submits. */
  onSubmit: (idTag: string) => void;
  /** Optional autofocus (default true — the form is typically revealed on demand). */
  autoFocus?: boolean;
  /** Disable the submit button (e.g. during an in-flight lookup). */
  disabled?: boolean;
}

export function ManualEntryForm({
  onSubmit,
  autoFocus = true,
  disabled = false,
}: Props) {
  const value = useSignal("");

  const submit = () => {
    const v = value.value.trim();
    if (!v) return;
    onSubmit(v);
  };

  return (
    <form
      class="flex w-full items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input
        type="text"
        placeholder="Enter idTag"
        class="font-mono"
        value={value.value}
        onInput={(e) =>
          (value.value = (e.target as HTMLInputElement).value)}
        autoFocus={autoFocus}
        aria-label="OCPP id tag"
      />
      <Button type="submit" size="sm" disabled={disabled || !value.value.trim()}>
        Look up
      </Button>
    </form>
  );
}
