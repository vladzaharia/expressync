/**
 * CustomerThemeToggle — light / dark / system theme picker for the
 * customer Account page.
 *
 * Polaris Track G3 — wraps the canonical `ToggleGroup` primitive and the
 * existing `useThemeToggle` hook so the customer surface uses the same
 * theme storage key (`polaris-theme`, set by SidebarLayout role="customer").
 */

import { useEffect, useState } from "preact/hooks";
import { Monitor, Moon, Sun } from "lucide-preact";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";

type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "polaris-theme";

/**
 * Apply theme + persist to localStorage. Mirrors the bootstrap script in
 * `_app.tsx` so client-side toggling stays consistent with first paint.
 */
function applyTheme(choice: ThemeChoice): void {
  if (choice === "system") {
    localStorage.setItem(STORAGE_KEY, "system");
    const sysIsDark =
      globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(sysIsDark ? "dark" : "light");
    return;
  }
  localStorage.setItem(STORAGE_KEY, choice);
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(choice);
}

export default function CustomerThemeToggle() {
  // Default to system to match the safest first-render assumption.
  const [value, setValue] = useState<ThemeChoice>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") {
        setValue(stored);
      } else {
        setValue("system");
      }
    } catch {
      setValue("system");
    }
  }, []);

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next: string) => {
        if (!next) return;
        const choice = next as ThemeChoice;
        setValue(choice);
        applyTheme(choice);
      }}
      variant="outline-joined"
      size="sm"
      aria-label="Theme"
    >
      <ToggleGroupItem value="light" aria-label="Light theme">
        <Sun class="size-4" aria-hidden="true" />
        <span class="ml-1.5">Light</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme">
        <Moon class="size-4" aria-hidden="true" />
        <span class="ml-1.5">Dark</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="System theme">
        <Monitor class="size-4" aria-hidden="true" />
        <span class="ml-1.5">System</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
