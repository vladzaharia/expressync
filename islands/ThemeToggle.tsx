import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@/components/ui/button.tsx";
import { Moon, Sun } from "lucide-preact";

const STORAGE_KEY = "ev-billing-theme";

export default function ThemeToggle() {
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

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="size-8"
      aria-label={`Switch to ${theme.value === "dark" ? "light" : "dark"} mode`}
    >
      {theme.value === "dark"
        ? <Sun className="size-4" />
        : <Moon className="size-4" />}
    </Button>
  );
}
