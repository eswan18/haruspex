"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Both icons are always rendered and CSS shows the one for the active theme,
 * from the `.dark` class next-themes puts on <html> before first paint: the
 * landing page's LandingThemeToggle does the same with its labels.
 *
 * Choosing the icon from `resolvedTheme` during render broke hydration in dark
 * mode (Sentry HARUSPEX-APP-B7, React error #418): the server cannot know the
 * theme and rendered the sun, while the browser's first render already knew it
 * and rendered the moon. suppressHydrationWarning did not help, as it covers
 * an element's own text and attributes, not a child element swapped for
 * another. The theme is read only on click, when it is always known.
 */
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="outline"
      size="icon"
      className="riso-icon-btn"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="h-4 w-4 dark:hidden" aria-hidden="true" />
      <Moon className="hidden h-4 w-4 dark:block" aria-hidden="true" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
