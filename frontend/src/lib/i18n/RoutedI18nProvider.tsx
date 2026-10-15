"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition, type ReactNode } from "react";
import type { Locale } from "./config";
import { I18nProvider } from "./I18nProvider";

/** The app's provider: after a switch it refreshes so server components render the new language. */
export function RoutedI18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  return (
    <I18nProvider locale={locale} onLocaleChange={refresh}>
      {children}
    </I18nProvider>
  );
}
