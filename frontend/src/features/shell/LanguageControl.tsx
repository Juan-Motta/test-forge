"use client";

import { LOCALES, useLocale, useSetLocale, useT, type Locale } from "@/lib/i18n";
import { SegmentedControl } from "@/ui";

/** EN / ES switch; the choice is kept in a cookie so the server renders in it. */
export function LanguageControl({ className }: { className?: string }) {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const options = LOCALES.map((value) => ({ value, label: t(`language.${value}`) }));
  return (
    <SegmentedControl<Locale>
      label={t("language.label")}
      options={options}
      value={locale}
      onChange={(next) => {
        if (next !== locale) setLocale(next);
      }}
      className={className}
    />
  );
}
