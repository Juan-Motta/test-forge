"use client";

import { useTheme, type ThemeChoice } from "@/lib/browser/theme";
import { useT } from "@/lib/i18n";
import { SegmentedControl } from "@/ui";

const CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

/** System / Light / Dark switch, remembered in this browser. */
export function ThemeControl({ className }: { className?: string }) {
  const t = useT();
  const [theme, setTheme] = useTheme();
  const options = CHOICES.map((value) => ({ value, label: t(`theme.${value}`) }));
  return <SegmentedControl label={t("theme.label")} options={options} value={theme} onChange={setTheme} className={className} />;
}
