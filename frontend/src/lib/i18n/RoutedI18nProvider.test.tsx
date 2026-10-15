import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALE_COOKIE } from "./config";
import { useLocale, useSetLocale } from "./I18nProvider";
import { RoutedI18nProvider } from "./RoutedI18nProvider";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function Switch() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  return (
    <button type="button" onClick={() => setLocale(locale === "en" ? "es" : "en")}>
      {locale}
    </button>
  );
}

afterEach(() => {
  router.refresh.mockReset();
  document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0`;
  document.documentElement.lang = "en";
});

describe("RoutedI18nProvider", () => {
  it("refreshes the route when the language switches, so server components render it", async () => {
    render(
      <RoutedI18nProvider locale="en">
        <Switch />
      </RoutedI18nProvider>,
    );
    expect(router.refresh).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: "en" }));

    expect(screen.getByRole("button", { name: "es" })).toBeInTheDocument();
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  });
});
