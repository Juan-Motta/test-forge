import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { ScenarioLibraryRail } from "./ScenarioLibraryRail";
import { scenarioFixture } from "./testing";

afterEach(() => vi.restoreAllMocks());

describe("Scenario library rail groups", () => {
  it("keeps a tag literally named untagged apart from the scenarios without tags", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const scenarios = [
      scenarioFixture({ id: "s-tagged", name: "Tagged untagged", tags: ["untagged"] }),
      scenarioFixture({ id: "s-bare", name: "No tags at all", tags: [] }),
    ];
    renderWithClient(<ScenarioLibraryRail scenarios={scenarios} failed={false} />);

    expect(screen.getByRole("heading", { name: "untagged 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Untagged 1" })).toBeInTheDocument();
    const duplicateKeys = errors.mock.calls.filter((call) => String(call[0]).includes("same key"));
    expect(duplicateKeys).toEqual([]);
  });
});
