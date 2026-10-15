import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Suggestion } from "@/features/judgements/types";
import { renderWithClient } from "@/test/render";
import { SuggestionsGrid } from "./SuggestionsGrid";

const base = { title: "Shorten the greeting", detail: "Say less.", area: "prompt", priority: "high", evidenceRefs: [] };
/** A suggestion as the judge sent it; `area` and `priority` may be values the app does not know. */
const suggestion = (changes: Record<string, unknown>) => ({ ...base, ...changes }) as Suggestion;

describe("Suggestions grid", () => {
  it("shows the area and priority the judge sent even when the app does not know them", () => {
    renderWithClient(<SuggestionsGrid suggestions={[suggestion({ area: "call_routing", priority: "urgent" })]} />);

    const list = screen.getByRole("list", { name: "Suggestions" });
    expect(list).toHaveTextContent("Call routing");
    expect(list).toHaveTextContent("Urgent");
  });

  it("translates the known area and priority", () => {
    renderWithClient(<SuggestionsGrid suggestions={[suggestion({ area: "latency", priority: "low" })]} />, { locale: "es" });

    const list = screen.getByRole("list", { name: "Sugerencias" });
    expect(list).toHaveTextContent("Latencia");
    expect(list).toHaveTextContent("Prioridad baja");
  });
});
