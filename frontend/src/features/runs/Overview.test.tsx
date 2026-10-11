import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithClient } from "@/test/render";
import { OverviewContainer } from "./OverviewContainer";
import { mockRunsApi, runFixture } from "./testing";

describe("Overview", () => {
  it("counts active, recorded and failed runs and lists the latest ones", async () => {
    mockRunsApi([
      runFixture({ id: "r-1", createdAt: "2026-10-05T10:00:00Z" }),
      runFixture({ id: "r-2", status: "failed", endReason: "tts_failed", createdAt: "2026-10-05T11:00:00Z" }),
      runFixture({ id: "r-3", status: "running", endReason: null, endedAt: null, createdAt: "2026-10-05T12:00:00Z" }),
      runFixture({ id: "r-4", status: "queued", endReason: null, startedAt: null, endedAt: null, createdAt: "2026-10-05T13:00:00Z" }),
    ]);
    renderWithClient(<OverviewContainer />);

    const stats = await screen.findByRole("list", { name: "Run counts" });
    expect(await within(stats).findByText("Active now")).toBeInTheDocument();
    expect(within(within(stats).getByRole("listitem", { name: "Active now" })).getByText("2")).toBeInTheDocument();
    expect(within(within(stats).getByRole("listitem", { name: "Runs recorded" })).getByText("4")).toBeInTheDocument();
    expect(within(within(stats).getByRole("listitem", { name: "Failed" })).getByText("1")).toBeInTheDocument();

    const recent = screen.getByRole("region", { name: "Latest runs" });
    const links = within(recent).getAllByRole("link", { name: /Booking with date change/ });
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/runs/r-4", "/runs/r-3", "/runs/r-2", "/runs/r-1"]);
  });

  it("invites a first launch when nothing ran yet", async () => {
    mockRunsApi([]);
    renderWithClient(<OverviewContainer />);
    expect(await screen.findByText("No runs yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to scenarios" })).toHaveAttribute("href", "/scenarios");
  });
});
