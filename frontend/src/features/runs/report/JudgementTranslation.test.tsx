import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { judgeResultFixture, judgementFixture, mockJudgementApi } from "@/features/judgements/testing";
import type { Judgement } from "@/features/judgements/types";
import type { Locale } from "@/lib/i18n";
import { renderWithClient } from "@/test/render";
import { RunDetailContainer } from "../RunDetailContainer";
import { mockRunsApi, runDetailFixture, runFixture } from "../testing";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

const RUN_ID = "0123456789abcdef";

const english = (translationStatus: "none" | "pending" | "failed", translationError: string | null = null) =>
  judgementFixture({ language: "en", translationStatus, translationError });

const spanish = () =>
  judgementFixture({
    language: "es",
    translationStatus: "ready",
    result: judgeResultFixture({
      summary: "El agente reservó la habitación pero nunca confirmó las fechas.",
      brief: "# Informe del juez\n\nCorrige la confirmación del cierre.",
    }),
  });

function renderReport(
  judgement: Judgement | Judgement[],
  locale: Locale,
  options: Parameters<typeof mockJudgementApi>[1] = {},
) {
  mockRunsApi([runFixture({ id: RUN_ID })], { details: { [RUN_ID]: runDetailFixture({ id: RUN_ID }) } });
  const api = mockJudgementApi({ [RUN_ID]: judgement }, options);
  const view = renderWithClient(<RunDetailContainer runId={RUN_ID} judgementPollMs={20} />, { locale });
  return { api, ...view };
}

describe("Run report · judgement in the page language", () => {
  it("asks for the English judgement on an English page and offers no translation", async () => {
    const { api } = renderReport(english("none"), "en");

    expect(await screen.findByText(judgeResultFixture().summary)).toBeInTheDocument();
    expect(api.langs[RUN_ID]).toEqual(["en"]);
    expect(screen.queryByRole("button", { name: /Spanish/ })).not.toBeInTheDocument();
  });

  it("shows the Spanish judgement on a Spanish page and copies the Spanish brief", async () => {
    const { api } = renderReport(spanish(), "es");
    const user = userEvent.setup();

    expect(await screen.findByText(/nunca confirmó las fechas/)).toBeInTheDocument();
    expect(api.langs[RUN_ID]?.[0]).toBe("es");
    expect(screen.queryByText("Esta evaluación del juez está en inglés.")).not.toBeInTheDocument();
    // The report's own words are Spanish too; the criterion texts and quotes are data.
    expect(screen.getByRole("group", { name: "Puntuación general" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Transcripción y criterios" })).toBeInTheDocument();
    expect(await screen.findAllByText("No cumple")).not.toHaveLength(0);
    expect(screen.getAllByText("Confirms the booking dates before closing")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Copiar informe" }));
    expect(await navigator.clipboard.readText()).toBe(spanish().result!.brief);
  });

  it("keeps polling while the Spanish version is pending and shows it once ready", async () => {
    const { api } = renderReport([english("pending"), english("pending"), spanish()], "es");

    expect(await screen.findByText("Traduciendo la evaluación del juez al español…")).toBeInTheDocument();
    expect(await screen.findByText(/nunca confirmó las fechas/)).toBeInTheDocument();
    expect(api.gets[RUN_ID]).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("Traduciendo la evaluación del juez al español…")).not.toBeInTheDocument();
  });

  it("translates an English-only judgement on request after confirming the paid call", async () => {
    const { api } = renderReport(english("none"), "es", { translated: { [RUN_ID]: [english("pending"), spanish()] } });
    const user = userEvent.setup();

    expect(await screen.findByText("Esta evaluación del juez está en inglés.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Traducir al español" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/de pago/);
    expect(api.translations).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: "Traducir" }));
    await waitFor(() => expect(api.translations).toEqual([{ id: RUN_ID, lang: "es" }]));
    expect(await screen.findByText(/nunca confirmó las fechas/)).toBeInTheDocument();
    expect(screen.queryByText("Esta evaluación del juez está en inglés.")).not.toBeInTheDocument();
  });

  it("explains why a translation failed and offers to try again", async () => {
    renderReport(english("failed", "The model returned a partial answer."), "es");

    expect(await screen.findByText("Esta evaluación del juez está en inglés.")).toBeInTheDocument();
    expect(screen.getByText(/The model returned a partial answer\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Traducir al español" })).toBeEnabled();
  });

  it("shows the refusal when the translation cannot start", async () => {
    renderReport(english("none"), "es", { translateConflict: "Judgement in progress" });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Traducir al español" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Traducir" }));

    expect(await screen.findByText(/Judgement in progress/)).toBeInTheDocument();
  });
});
