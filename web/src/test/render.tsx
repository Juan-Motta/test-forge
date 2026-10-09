import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";

/** Renders with a fresh, retry-free query client so tests never share cache or wait on retries. */
export function renderWithClient(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, options);
  return { ...result, queryClient };
}
