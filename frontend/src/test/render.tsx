import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nProvider, type Locale } from "@/lib/i18n";

type RenderWithClientOptions = RenderOptions & {
  /** The page language (default English, so tests read the English copy). */
  locale?: Locale;
};

/**
 * Renders with a fresh, retry-free query client so tests never share cache or wait on retries,
 * inside the i18n provider (English unless `locale` says otherwise).
 */
export function renderWithClient(ui: ReactElement, { locale = "en", ...options }: RenderWithClientOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale={locale}>{ui}</I18nProvider>
    </QueryClientProvider>,
    options,
  );
  return { ...result, queryClient };
}
