import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { runFixture } from "@/features/runs/testing";
import { LiveNowCard } from "./LiveNowCard";

describe("Live now card", () => {
  it("offers to listen in on calls and to watch text conversations", () => {
    const now = Date.parse("2026-10-05T16:01:00Z");
    const runs = [
      runFixture({ id: "r-voice", scenarioName: "Voice booking", status: "running" }),
      runFixture({ id: "r-text", scenarioName: "Chat booking", status: "running", agentKind: "text" }),
    ];
    render(<LiveNowCard runs={runs} total={2} error={null} now={now} />);

    const voice = screen.getByRole("article", { name: "Voice booking" });
    expect(within(voice).getByRole("link", { name: "Listen in" })).toBeInTheDocument();
    const text = screen.getByRole("article", { name: "Chat booking" });
    expect(within(text).getByRole("link", { name: "Watch" })).toBeInTheDocument();
    expect(within(text).queryByRole("link", { name: "Listen in" })).not.toBeInTheDocument();
  });

  it("names runs, not calls, when nothing is running", () => {
    render(<LiveNowCard runs={[]} total={0} error={null} now={0} />);
    expect(screen.getByText("Nothing running right now.")).toBeInTheDocument();
  });
});
