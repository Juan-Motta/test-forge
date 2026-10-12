import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRun } from "@/features/runs/queries";
import { runDetailFixture } from "@/features/runs/testing";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { REVOKE_BRIEF_URL_MS, ScoreContainer } from "./ScoreContainer";
import { judgeResultFixture, judgeResultV2Fixture, judgementFixture, mockJudgementApi } from "./testing";
import type { Judgement } from "./types";

const RUN_ID = "0123456789abcdef";
const ENDED_LONG_AGO = "2026-01-01T00:00:00Z";

function renderSection(judgement: Judgement | Judgement[], options: { rejudgeConflict?: string } = {}) {
  const api = mockJudgementApi({ [RUN_ID]: judgement }, options);
  const view = renderWithClient(<ScoreContainer runId={RUN_ID} endedAt={ENDED_LONG_AGO} pollMs={20} />);
  return { api, ...view };
}

const section = () => screen.getByRole("region", { name: "Score & suggestions" });

describe("Score & suggestions", () => {
  // jsdom has no object URLs; the download test installs fakes and this puts the originals back.
  const { createObjectURL, revokeObjectURL } = URL;
  afterEach(() => {
    vi.useRealTimers();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });

  it("offers to judge a run that was never judged", async () => {
    const { api } = renderSection({ status: "none" });
    const user = userEvent.setup();

    expect(await screen.findByText("Not judged yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Judge run" }));

    await waitFor(() => expect(api.posts).toEqual([RUN_ID]));
    expect(await screen.findByText("Queued for the judge…")).toBeInTheDocument();
  });

  it("shows progress while judging and disables re-judging", async () => {
    renderSection(judgementFixture({ status: "judging", result: null, completedAt: null }));

    expect(await screen.findByText("The judge is scoring this run…")).toBeInTheDocument();
    expect(within(section()).getByRole("button", { name: "Re-judge" })).toBeDisabled();
  });

  it("explains the wait for Langfuse traces with the elapsed time", async () => {
    const since = new Date(Date.now() - 125_000).toISOString();
    renderSection(judgementFixture({ status: "collecting_traces", result: null, completedAt: null, updatedAt: since }));

    expect(await screen.findByText(/Waiting for Langfuse traces — they can take up to ~15 min to appear/)).toBeInTheDocument();
    expect(screen.getByText(/^Waiting 2m 0[3-9]s$/)).toBeInTheDocument();
  });

  it("shows why a judgement failed and retries it", async () => {
    const { api } = renderSection(
      judgementFixture({ status: "failed", result: null, error: "The judge model timed out", completedAt: null }),
    );
    const user = userEvent.setup();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The judgement failed");
    expect(alert).toHaveTextContent("The judge model timed out");
    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(api.posts).toEqual([RUN_ID]));
  });

  it("renders a completed judgement: score, verdicts, evidence, suggestions and strengths", async () => {
    renderSection(judgementFixture());

    const score = await screen.findByRole("group", { name: "Overall score" });
    expect(score).toHaveTextContent("72/100");
    expect(score).toHaveTextContent("Fair");
    expect(within(score).getByText("Must criterion failed")).toBeInTheDocument();
    expect(screen.getByText(judgeResultFixture().summary)).toBeInTheDocument();
    expect(screen.getByText("Traces: 3 traces · 41 observations · 1 error · gpt-6-luna")).toBeInTheDocument();

    // Direct children only: each criterion's evidence is a nested list.
    const items = Array.from(screen.getByRole("list", { name: "Criteria" }).children) as HTMLElement[];
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Fail");
    expect(items[0]).toHaveTextContent("20/100");
    expect(items[0]).toHaveTextContent("weight 3");
    expect(items[0]).toHaveTextContent("Must");
    expect(items[0]).toHaveTextContent("Confirms the booking dates before closing");
    expect(items[0]).toHaveTextContent("Evidence (1)");
    expect(within(items[0]).getByRole("link", { name: "Go to transcript turn A2" })).toHaveAttribute(
      "href",
      "#turn-A2",
    );
    expect(items[1]).toHaveTextContent("Pass");
    expect(items[2]).toHaveTextContent("Not observable");
    expect(items[2]).toHaveTextContent("—");

    const suggestions = screen.getByRole("list", { name: "Suggestions" });
    expect(suggestions).toHaveTextContent("High priority");
    expect(suggestions).toHaveTextContent("prompt");
    expect(suggestions).toHaveTextContent("Read the dates back before closing");
    expect(within(suggestions).getByText("R1")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Strengths" })).toHaveTextContent("Friendly greeting");

    // A v1 result has no bands, failure tags, caps or not-observable reasons.
    expect(items[0]).not.toHaveTextContent("/5");
    expect(screen.queryByText("Capped")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Failure tags" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Failure tags" })).not.toBeInTheDocument();
  });

  it("renders a v2 judgement: bands, caps, failure tags and why a criterion was not observable", async () => {
    renderSection(judgementFixture({ result: judgeResultV2Fixture() }));

    const list = await screen.findByRole("list", { name: "Criteria" });
    const items = Array.from(list.children) as HTMLElement[];
    expect(items).toHaveLength(4);

    expect(items[0]).toHaveTextContent("50/100");
    expect(items[0]).toHaveTextContent("Band 2/5");
    expect(within(items[0]).getByText("Capped")).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("Capped at 2/5 because of fabricated information");
    const tags = within(items[0]).getByRole("list", { name: "Failure tags" });
    expect(within(tags).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Fabricated information",
      "Incomplete task",
    ]);

    expect(items[1]).toHaveTextContent("Band 5/5");
    expect(within(items[1]).queryByText("Capped")).not.toBeInTheDocument();
    expect(within(items[1]).queryByRole("list", { name: "Failure tags" })).not.toBeInTheDocument();

    expect(items[2]).toHaveTextContent("Not observable");
    expect(items[2]).toHaveTextContent("Traces unavailable");
    expect(items[2]).not.toHaveTextContent("/5");

    // An unknown tag still reads as words.
    expect(within(items[3]).getByRole("list", { name: "Failure tags" })).toHaveTextContent("Some new tag");

    const summary = screen.getByRole("region", { name: "Failure tags" });
    expect(within(summary).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Incomplete task: 2 criteria",
      "Fabricated information: 1 criterion",
      "Some new tag: 1 criterion",
    ]);
  });

  it.each([
    ["no_timing_data", "No timing data"],
    ["judge_marked_unobservable", "The judge could not observe it"],
    ["judge_omitted", "The judge gave no verdict"],
  ] as const)("explains a criterion not observable because of %s", async (reason, text) => {
    const base = judgeResultV2Fixture();
    const criteria = base.criteria.map((criterion) =>
      criterion.criterionId === "c-3" ? { ...criterion, unobservableReason: reason } : criterion,
    );
    renderSection(judgementFixture({ result: { ...base, criteria } }));

    const items = Array.from((await screen.findByRole("list", { name: "Criteria" })).children) as HTMLElement[];
    expect(items[2]).toHaveTextContent(text);
  });

  it("says when traces were unavailable", async () => {
    renderSection(
      judgementFixture({
        result: judgeResultFixture({ traceStats: null, traceNote: "the agent has no Langfuse connection" }),
      }),
    );

    expect(await screen.findByText("Traces unavailable: the agent has no Langfuse connection")).toBeInTheDocument();
  });

  it("copies the brief to the clipboard", async () => {
    renderSection(judgementFixture());
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Copy brief" }));

    expect(await navigator.clipboard.readText()).toBe(judgeResultFixture().brief);
    expect(screen.getByText("Brief copied")).toBeInTheDocument();
  });

  it("downloads the brief as a Markdown file", async () => {
    const createObjectURL = vi.fn((blob: Blob) => (blob instanceof Blob ? "blob:brief" : ""));
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
    renderSection(judgementFixture());
    const download = await screen.findByRole("button", { name: "Download .md" });

    // Revoking in the same tick as the click can abort the download, so it waits.
    vi.useFakeTimers();
    fireEvent.click(download);
    expect(clicks).toHaveLength(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_BRIEF_URL_MS);

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/markdown");
    expect(await blob.text()).toBe(judgeResultFixture().brief);
    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe("judge-brief-01234567.md");
    expect(clicks[0].href).toBe("blob:brief");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:brief");
  });

  it("re-judges and shows the conflict when a judgement is already running", async () => {
    const { api } = renderSection(judgementFixture(), { rejudgeConflict: "Judgement already in progress" });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Re-judge" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not judge: Judgement already in progress");
    expect(api.posts).toEqual([RUN_ID]);
  });

  it("polls while the judgement is in progress and stops once it completes", async () => {
    const pending = judgementFixture({ status: "pending", result: null, completedAt: null });
    const judging = judgementFixture({ status: "judging", result: null, completedAt: null });
    const { api } = renderSection([pending, judging, judgementFixture()]);

    expect(await screen.findByRole("group", { name: "Overall score" }, { timeout: 2000 })).toBeInTheDocument();
    const settled = api.gets[RUN_ID];
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(api.gets[RUN_ID]).toBe(settled);
  });

  it("refreshes the runs once the judgement finishes, so their score and status are current", async () => {
    const runGets = { count: 0 };
    server.use(
      http.get(apiUrl("/runs/:id"), () => {
        runGets.count += 1;
        return HttpResponse.json(runDetailFixture({ id: RUN_ID }));
      }),
    );
    function RunProbe() {
      useRun(RUN_ID);
      return null;
    }
    const pending = judgementFixture({ status: "pending", result: null, completedAt: null });
    mockJudgementApi({ [RUN_ID]: [pending, judgementFixture()] });
    renderWithClient(
      <>
        <RunProbe />
        <ScoreContainer runId={RUN_ID} endedAt={ENDED_LONG_AGO} pollMs={20} />
      </>,
    );

    await waitFor(() => expect(runGets.count).toBe(1));
    expect(await screen.findByRole("group", { name: "Overall score" })).toBeInTheDocument();
    await waitFor(() => expect(runGets.count).toBe(2));
  });
});
