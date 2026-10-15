"use client";

import { useTheme, type ThemeChoice } from "@/lib/browser/theme";
import { SegmentedControl, type SegmentOption } from "@/ui";

const OPTIONS: readonly SegmentOption<ThemeChoice>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** System / Light / Dark switch, remembered in this browser. */
export function ThemeControl({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  return <SegmentedControl label="Theme" options={OPTIONS} value={theme} onChange={setTheme} className={className} />;
}
