import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { renderWithClient } from "@/test/render";
import { ThemeControl } from "@/features/theme/ThemeControl";
import { LanguageControl } from "./LanguageControl";

afterEach(() => {
  document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0`;
});

describe("LanguageControl", () => {
  it("offers EN and ES with the current language checked", () => {
    renderWithClient(<LanguageControl />);
    expect(screen.getByRole("radiogroup", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "EN" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "ES" })).toHaveAttribute("aria-checked", "false");
  });

  it("switches the page to Spanish and remembers it in the cookie", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <>
        <LanguageControl />
        <ThemeControl />
      </>,
    );
    await user.click(screen.getByRole("radio", { name: "ES" }));

    expect(screen.getByRole("radiogroup", { name: "Idioma" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Tema" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Oscuro" })).toBeInTheDocument();
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=es`);
  });

  it("renders in Spanish when the page is", () => {
    renderWithClient(<LanguageControl />, { locale: "es" });
    expect(screen.getByRole("radio", { name: "ES" })).toHaveAttribute("aria-checked", "true");
  });
});
