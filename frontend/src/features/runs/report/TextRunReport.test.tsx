import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import { judgeResultFixture, judgementFixture, mockJudgementApi } from "@/features/judgements/testing";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { RunDetailContainer } from "../RunDetailContainer";
import { mockRunsApi, runFixture, textRunDetailFixture } from "../testing";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

const RUN_ID = "0123456789abcdef";

function renderTextReport() {
  const audioRequests: string[] = [];
  mockRunsApi([runFixture({ id: RUN_ID, agentKind: "text" })], {
    details: { [RUN_ID]: textRunDetailFixture({ id: RUN_ID }) },
  });
  server.use(
    http.get(apiUrl("/runs/:id/levels"), ({ request }) => {
      audioRequests.push(request.url);
      return HttpResponse.json({ detail: "Not found" }, { status: 404 });
    }),
  );
  const failA3 = judgeResultFixture({
    criteria: [
      {
        ...judgeResultFixture().criteria[0],
        text: "Answers the parking question",
        evidence: [{ source: "transcript", ref: "A3", quote: "Let me check the" }],
      },
    ],
  });
  mockJudgementApi({ [RUN_ID]: judgementFixture({ result: failA3 }) });
  renderWithClient(<RunDetailContainer runId={RUN_ID} judgementPollMs={20} />);
  return { audioRequests };
}

describe("Run report · text runs", () => {
  it("shows the conversation metrics instead of the recording, and never asks for audio", async () => {
    const { audioRequests } = renderTextReport();

    const card = await screen.findByRole("region", { name: "Conversation" });
    const metric = (label: string) => within(card).getByText(label).closest("div")!;
    expect(metric("Mode")).toHaveTextContent("Stream");
    expect(metric("User messages")).toHaveTextContent("3");
    expect(metric("Agent replies")).toHaveTextContent("2");
    expect(metric("First text p50")).toHaveTextContent("1.2 s");
    expect(metric("Slowest first text")).toHaveTextContent("1.6 s");
    expect(metric("Full reply p50")).toHaveTextContent("2.5 s");
    expect(metric("Tools used")).toHaveTextContent("1");
    expect(metric("Ended")).toHaveTextContent("The agent's reply failed");
    // Mode, duration and end reason are chips by the title; the figures sit in their own grid.
    const [chips, figures] = within(card).getAllByRole("definition").reduce<[HTMLElement[], HTMLElement[]]>(
      (groups, item) => (item.querySelector("[data-tone]") ? [[...groups[0], item], groups[1]] : [groups[0], [...groups[1], item]]),
      [[], []],
    );
    expect(chips.map((chip) => chip.textContent)).toEqual(["Stream", expect.any(String), "The agent's reply failed"]);
    expect(figures.map((figure) => figure.textContent)).toContain("1.2 s");

    expect(screen.queryByRole("region", { name: "Call recording" })).not.toBeInTheDocument();
    expect(document.querySelector("audio")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(audioRequests).toEqual([]);
  });

  it("names the text agent and its mode in the header instead of the evaluator voice", async () => {
    renderTextReport();

    const details = await screen.findByRole("list", { name: "Run details" });
    expect(within(details).getByText("Text agent · Stream")).toBeInTheDocument();
    expect(within(details).queryByText(/evaluator/i)).not.toBeInTheDocument();
  });

  it("shows a chat with reply timings, tool chips and the reply that broke off, pinned by the judge", async () => {
    renderTextReport();

    const transcript = await screen.findByRole("list", { name: "Conversation transcript" });
    const rows = Array.from(transcript.children) as HTMLElement[];
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveAttribute("id", "turn-C1");
    expect(rows[0]).toHaveTextContent("User");
    expect(rows[1]).toHaveAttribute("id", "turn-A1");
    expect(rows[1]).toHaveTextContent("First text in 800 ms");
    expect(rows[1]).toHaveTextContent("full reply in 1.5 s");
    expect(within(rows[1]).getByText("check_availability")).toBeInTheDocument();
    expect(rows[3]).toHaveTextContent("full reply in 3.5 s");
    expect(rows[5]).toHaveTextContent("Reply broke off");
    await waitFor(() => expect(rows[5]).toHaveAttribute("data-issue", "1"));
    expect(rows[5]).toHaveTextContent("Issue 1: Answers the parking question");
  });
});
