import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithClient } from "@/test/render";
import { RunStatus } from "./run-fields";
import { runFixture } from "./testing";

describe("Run status in Spanish", () => {
  it("does not repeat the status when the run ended only because it was cancelled", () => {
    renderWithClient(<RunStatus run={runFixture({ status: "cancelled", endReason: "cancelled" })} />, { locale: "es" });

    expect(screen.getAllByText("Cancelada")).toHaveLength(1);
  });

  it("adds why the run ended when the reason says more than the status", () => {
    renderWithClient(<RunStatus run={runFixture({ status: "failed", endReason: "connect_failed" })} />, { locale: "es" });

    expect(screen.getByText("Fallida")).toBeInTheDocument();
    expect(screen.getByText("No se pudo conectar con el agente")).toBeInTheDocument();
  });
});
