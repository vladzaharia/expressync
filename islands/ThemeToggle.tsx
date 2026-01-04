import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Moon, Sun } from "lucide-preact";

const STORAGE_KEY = "ev-billing-theme";

interface ThemeToggleProps {
  /** If true, only render the icon (for use in sidebar) */
  iconOnly?: boolean;
}

export default function ThemeToggle({ iconOnly = true }: ThemeToggleProps) {
  const theme = useSignal<"light" | "dark">("dark");

  // Initialize theme from localStorage and system preference
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      theme.value = stored;
    } else if (
      globalThis.matchMedia?.("(prefers-color-scheme: light)").matches
    ) {
      theme.value = "light";
    }

    // Apply theme to document
    document.documentElement.classList.toggle("dark", theme.value === "dark");
  }, []);

  const toggleTheme = () => {
    const newTheme = theme.value === "dark" ? "light" : "dark";
    theme.value = newTheme;
    localStorage.setItem(STORAGE_KEY, newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
  };

  // Just render the icon - parent handles click
  if (iconOnly) {
    return theme.value === "dark"
      ? <Sun className="size-5 shrink-0" />
      : <Moon className="size-5 shrink-0" />;
  }

  // Full clickable version (unused currently)
  return (
    <button
      onClick={toggleTheme}
      className="size-5"
      aria-label={`Switch to ${theme.value === "dark" ? "light" : "dark"} mode`}
    >
      {theme.value === "dark"
        ? <Sun className="size-5" />
        : <Moon className="size-5" />}
    </button>
  );
}

// Export the toggle function for use in parent components
export function useThemeToggle() {
  const toggleTheme = () => {
    const current = document.documentElement.classList.contains("dark") ? "dark" : "light";
    const newTheme = current === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
  };
  return toggleTheme;
}
