import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALE_COOKIE } from "./config";
import { I18nProvider, T, useLocale, useSetLocale, useT } from "./I18nProvider";

function Probe() {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  return (
    <div>
      <p>{t("theme.label")}</p>
      <p data-testid="locale">{locale}</p>
      <button type="button" onClick={() => setLocale(locale === "en" ? "es" : "en")}>
        toggle
      </button>
    </div>
  );
}

afterEach(() => {
  document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0`;
  document.documentElement.lang = "en";
});

describe("I18nProvider", () => {
  it("translates with the locale it is given", () => {
    render(
      <I18nProvider locale="es">
        <Probe />
        <T k="shell.environment" vars={{ label: "local" }} />
      </I18nProvider>,
    );
    expect(screen.getByText("Tema")).toBeInTheDocument();
    expect(screen.getByText("Entorno · local")).toBeInTheDocument();
  });

  it("falls back to English outside a provider", () => {
    render(<Probe />);
    expect(screen.getByText("Theme")).toBeInTheDocument();
  });

  it("switching writes the cookie, updates <html lang> and the text, then asks for a refresh", async () => {
    const user = userEvent.setup();
    const onLocaleChange = vi.fn();
    render(
      <I18nProvider locale="en" onLocaleChange={onLocaleChange}>
        <Probe />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.getByText("Tema")).toBeInTheDocument();
    expect(screen.getByTestId("locale")).toHaveTextContent("es");
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=es`);
    expect(document.documentElement.lang).toBe("es");
    expect(onLocaleChange).toHaveBeenCalledWith("es");
  });

  it("follows a new locale from the server (after a refresh)", () => {
    const { rerender } = render(
      <I18nProvider locale="en">
        <Probe />
      </I18nProvider>,
    );
    rerender(
      <I18nProvider locale="es">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText("Tema")).toBeInTheDocument();
  });
});
