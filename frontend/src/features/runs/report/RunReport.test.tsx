import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REVOKE_BRIEF_URL_MS } from "@/features/judgements/use-judgement-controller";
import { judgeResultFixture, judgeResultV2Fixture, judgementFixture, mockJudgementApi } from "@/features/judgements/testing";
import type { Judgement } from "@/features/judgements/types";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { RunDetailContainer } from "../RunDetailContainer";
import { levelsFixture, mockLangfuseLookup, mockRunsApi, runDetailFixture, runFixture, traceFixture } from "../testing";
import type { RunLevels, RunTrace } from "../types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

const RUN_ID = "0123456789abcdef";

type Options = {
  rejudgeConflict?: string;
  levels?: RunLevels | number;
  trace?: RunTrace;
};

function renderReport(judgement: Judgement | Judgement[], options: Options = {}) {
  const runs = mockRunsApi([runFixture({ id: RUN_ID })], {
    details: { [RUN_ID]: runDetailFixture({ id: RUN_ID }) },
    levels: options.levels === undefined ? undefined : { [RUN_ID]: options.levels },
    traces: options.trace ? { [RUN_ID]: options.trace } : undefined,
  });
  const api = mockJudgementApi({ [RUN_ID]: judgement }, { rejudgeConflict: options.rejudgeConflict });
  const view = renderWithClient(<RunDetailContainer runId={RUN_ID} judgementPollMs={20} />);
  return { api, runs, ...view };
}

const judgementCard = () => screen.getByRole("region", { name: "Judgement" });
const criteriaItems = async () =>
  // Direct children only: each criterion's quotes are a nested list.
  Array.from((await screen.findByRole("list", { name: "Criteria" })).children) as HTMLElement[];

async function openTab(name: RegExp | string) {
  await userEvent.setup().click(await screen.findByRole("tab", { name }));
}

describe("Run report · header and active runs", () => {
  it("copies the brief from the header", async () => {
    renderReport(judgementFixture());
    const user = userEvent.setup();

    const header = (await screen.findByRole("heading", { level: 1 })).closest("header")!;
    await user.click(await within(header).findByRole("button", { name: "Copy brief" }));

    expect(await navigator.clipboard.readText()).toBe(judgeResultFixture().brief);
  });

  it("asks nothing of the judge while the run is active and shows only the passive Judgement card", async () => {
    mockRunsApi([runFixture({ id: RUN_ID, status: "running", endedAt: null })], {
      details: { [RUN_ID]: runDetailFixture({ id: RUN_ID, status: "running", endedAt: null }) },
    });
    const api = mockJudgementApi({ [RUN_ID]: judgementFixture() });
    const { queryClient } = renderWithClient(<RunDetailContainer runId={RUN_ID} judgementPollMs={20} />);

    const card = await screen.findByRole("region", { name: "Judgement" });
    expect(card).toHaveTextContent("The judge scores the run once it finishes.");
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(api.gets[RUN_ID]).toBeUndefined();
    expect(api.posts).toEqual([]);
    expect(screen.queryByRole("button", { name: "Copy brief" })).not.toBeInTheDocument();
  });
});

describe("Run report · judgement states", () => {
  it("offers to judge a run that was never judged", async () => {
    const { api } = renderReport({ status: "none" });
    const user = userEvent.setup();

    expect(await screen.findByText(/^Not judged yet\./)).toBeInTheDocument();
    expect(screen.getByText("The scorecard appears once the run is judged.")).toBeInTheDocument();
    await user.click(within(judgementCard()).getByRole("button", { name: "Judge run" }));

    await waitFor(() => expect(api.posts).toEqual([RUN_ID]));
    expect(await screen.findByText("Queued for the judge…")).toBeInTheDocument();
  });

  it("shows progress while judging and disables re-judging", async () => {
    renderReport(judgementFixture({ status: "judging", result: null, completedAt: null }));

    expect(await screen.findByText("The judge is scoring this run…")).toBeInTheDocument();
    expect(within(judgementCard()).getByRole("button", { name: "Re-judge" })).toBeDisabled();
  });

  it("explains the wait for Langfuse traces with the elapsed time", async () => {
    const since = new Date(Date.now() - 125_000).toISOString();
    renderReport(judgementFixture({ status: "collecting_traces", result: null, completedAt: null, updatedAt: since }));

    expect(await screen.findByText(/Waiting for Langfuse traces — they can take up to ~15 min to appear/)).toBeInTheDocument();
    expect(screen.getByText(/^Waiting 2m 0[3-9]s$/)).toBeInTheDocument();
  });

  it("shows why a judgement failed and retries it", async () => {
    const { api } = renderReport(
      judgementFixture({ status: "failed", result: null, error: "The judge model timed out", completedAt: null }),
    );
    const user = userEvent.setup();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The judgement failed");
    expect(alert).toHaveTextContent("The judge model timed out");
    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(api.posts).toEqual([RUN_ID]));
  });

  it("re-judges and shows the conflict when a judgement is already running", async () => {
    const { api } = renderReport(judgementFixture(), { rejudgeConflict: "Judgement already in progress" });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Re-judge" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not judge: Judgement already in progress");
    expect(api.posts).toEqual([RUN_ID]);
  });

  it("polls while the judgement is in progress and stops once it completes", async () => {
    const pending = judgementFixture({ status: "pending", result: null, completedAt: null });
    const judging = judgementFixture({ status: "judging", result: null, completedAt: null });
    const { api } = renderReport([pending, judging, judgementFixture()]);

    expect(await screen.findByRole("group", { name: "Overall score" }, { timeout: 2000 })).toBeInTheDocument();
    const settled = api.gets[RUN_ID];
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(api.gets[RUN_ID]).toBe(settled);
  });

  it("refreshes the run once the judgement finishes, so its score and status are current", async () => {
    const runGets = { count: 0 };
    mockRunsApi([runFixture({ id: RUN_ID })]);
    server.use(
      http.get(apiUrl("/runs/:id"), () => {
        runGets.count += 1;
        return HttpResponse.json(runDetailFixture({ id: RUN_ID }));
      }),
    );
    mockJudgementApi({ [RUN_ID]: [judgementFixture({ status: "pending", result: null, completedAt: null }), judgementFixture()] });
    renderWithClient(<RunDetailContainer runId={RUN_ID} judgementPollMs={20} />);

    await waitFor(() => expect(runGets.count).toBe(1));
    expect(await screen.findByRole("group", { name: "Overall score" })).toBeInTheDocument();
    await waitFor(() => expect(runGets.count).toBe(2));
  });
});

describe("Run report · verdict and scorecard", () => {
  it("shows the overall score, goals met and the judge's summary", async () => {
    renderReport(judgementFixture());

    const score = await screen.findByRole("group", { name: "Overall score" });
    expect(score).toHaveTextContent("72/100");
    expect(score).toHaveTextContent("Fair");
    expect(within(score).getByRole("meter")).toHaveAttribute("aria-valuenow", "72");
    expect(within(score).getByText("Must criterion failed")).toBeInTheDocument();

    const goals = screen.getByRole("group", { name: "Goals met" });
    expect(goals).toHaveTextContent("1/ 2");
    expect(goals).toHaveTextContent("Missed: Confirms the booking dates before closing");
    expect(goals).toHaveTextContent("1 not observable");

    const summary = screen.getByRole("region", { name: "Judge summary" });
    expect(summary).toHaveTextContent(judgeResultFixture().summary);
    expect(summary).toHaveTextContent("Traces: 3 traces · 41 observations · 1 error · gpt-6-luna");
    expect(summary).toHaveTextContent("Strengths: Friendly greeting");
    expect(summary).toHaveTextContent("Judged by gpt-6-judge");
  });

  it("renders a v1 scorecard: verdicts, scores, evidence links, and no v2 details", async () => {
    renderReport(judgementFixture());

    const items = await criteriaItems();
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Fail");
    expect(items[0]).toHaveTextContent("20/100");
    expect(items[0]).toHaveTextContent("weight 3");
    expect(items[0]).toHaveTextContent("Must");
    expect(items[0]).toHaveTextContent("Confirms the booking dates before closing");
    expect(items[0]).toHaveTextContent("Quotes (1)");
    expect(within(items[0]).getByRole("link", { name: "Go to transcript turn A2" })).toHaveAttribute("href", "#turn-A2");
    expect(items[1]).toHaveTextContent("Pass");
    expect(within(items[1]).queryByRole("link")).not.toBeInTheDocument();
    expect(items[2]).toHaveTextContent("Not observable");
    expect(items[2]).toHaveTextContent("—");

    expect(items[0]).not.toHaveTextContent("/5");
    expect(screen.queryByText("Capped")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Failure tags" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Failure tag counts" })).not.toBeInTheDocument();
    expect(screen.queryByText("Judges disagreed")).not.toBeInTheDocument();
  });

  it("renders a v2 scorecard: bands, caps, failure tags, unobservable reasons and judge samples", async () => {
    const base = judgeResultV2Fixture();
    const criteria = base.criteria.map((criterion, index) =>
      index === 0 ? { ...criterion, sampleBands: [2, 4, 2] } : index === 1 ? { ...criterion, sampleBands: [5, 5, 4] } : criterion,
    );
    renderReport(judgementFixture({ result: { ...base, criteria, samples: 3 } }));

    const items = await criteriaItems();
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
    expect(within(items[0]).getByRole("img", { name: "Judge samples: band 2, band 4, band 2" })).toBeInTheDocument();
    expect(within(items[0]).getByText("Judges disagreed")).toBeInTheDocument();

    expect(items[1]).toHaveTextContent("Band 5/5");
    expect(within(items[1]).queryByText("Capped")).not.toBeInTheDocument();
    expect(within(items[1]).queryByRole("list", { name: "Failure tags" })).not.toBeInTheDocument();
    expect(within(items[1]).queryByText("Judges disagreed")).not.toBeInTheDocument();

    expect(items[2]).toHaveTextContent("Not observable");
    expect(items[2]).toHaveTextContent("Traces unavailable");
    expect(items[2]).not.toHaveTextContent("/5");

    expect(within(items[3]).getByRole("list", { name: "Failure tags" })).toHaveTextContent("Some new tag");

    const counts = screen.getByRole("list", { name: "Failure tag counts" });
    expect(within(counts).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Incomplete task: 2 criteria",
      "Fabricated information: 1 criterion",
      "Some new tag: 1 criterion",
    ]);
    expect(screen.getByRole("region", { name: "Judge summary" })).toHaveTextContent("Judged by gpt-6-judge · 3 samples");
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
    renderReport(judgementFixture({ result: { ...base, criteria } }));

    const items = await criteriaItems();
    expect(items[2]).toHaveTextContent(text);
  });

  it("says when traces were unavailable to the judge", async () => {
    renderReport(
      judgementFixture({
        result: judgeResultFixture({ traceStats: null, traceNote: "the agent has no Langfuse connection" }),
      }),
    );

    expect(await screen.findByText("Traces unavailable: the agent has no Langfuse connection")).toBeInTheDocument();
  });
});

describe("Run report · issues on the transcript and the recording", () => {
  it("outlines the turns failed criteria cite and pins them on the recording lanes", async () => {
    renderReport(judgementFixture());

    const transcript = await screen.findByRole("list", { name: "Transcript" });
    await screen.findByRole("group", { name: "Overall score" });
    const row = within(transcript).getAllByRole("listitem")[2];
    expect(row).toHaveAttribute("id", "turn-A2");
    expect(row).toHaveAttribute("data-issue", "1");
    expect(row).toHaveTextContent("Issue 1: Confirms the booking dates before closing");
    expect(within(transcript).getAllByRole("listitem")[0]).not.toHaveAttribute("data-issue");

    const pin = await screen.findByRole("button", { name: "Issue 1 at 0:05: Confirms the booking dates before closing" });
    expect(pin.parentElement).toHaveStyle({ left: `${((5420 + 7000) / 2 / 252_000) * 100}%` });
    await userEvent.setup().click(pin);
    expect(row).toHaveFocus();
  });

  it("draws both audio lanes on the run timeline with a time axis", async () => {
    renderReport({ status: "none" });

    const recording = await screen.findByRole("region", { name: "Call recording" });
    expect(await within(recording).findByText("Agent audio levels over the run")).toBeInTheDocument();
    expect(within(recording).getByText("Evaluator audio levels over the run")).toBeInTheDocument();
    expect(within(recording).getByText("4:12 · agent and evaluator on the run timeline")).toBeInTheDocument();
    for (const tick of ["0:00", "1:03", "2:06", "3:09", "4:12"]) {
      expect(within(recording).getAllByText(tick).length).toBeGreaterThan(0);
    }
    expect(within(recording).getByLabelText("Agent track")).toHaveAttribute("src", `/api/runs/${RUN_ID}/audio/agent`);
  });

  it("plays and downloads the conversation as one recording, with the separate tracks collapsed", async () => {
    renderReport({ status: "none" });

    const recording = await screen.findByRole("region", { name: "Call recording" });
    expect(within(recording).getByLabelText("Conversation")).toHaveAttribute(
      "src",
      `/api/runs/${RUN_ID}/audio/conversation`,
    );
    expect(within(recording).getByRole("link", { name: "Download conversation .wav" })).toHaveAttribute(
      "href",
      `/api/runs/${RUN_ID}/audio/conversation?download=1`,
    );
    const separate = within(recording).getByText("Separate tracks").closest("details");
    expect(separate).not.toBeNull();
    expect(separate).not.toHaveAttribute("open");
    expect(within(separate!).getByLabelText("Agent track")).toHaveAttribute("src", `/api/runs/${RUN_ID}/audio/agent`);
    expect(within(separate!).getByLabelText("Evaluator track")).toHaveAttribute(
      "src",
      `/api/runs/${RUN_ID}/audio/caller`,
    );
    expect(within(separate!).getByText(/not aligned in time/)).toBeInTheDocument();
  });

  it("explains missing lanes when the levels are not ready (409)", async () => {
    renderReport({ status: "none" }, { levels: 409 });

    expect(await screen.findByText("The audio lanes appear once the run finishes.")).toBeInTheDocument();
    expect(screen.getByLabelText("Evaluator track")).toBeInTheDocument();
  });

  it("opens the transcript at a suggestion's evidence turn", async () => {
    renderReport(judgementFixture(), { levels: levelsFixture() });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("tab", { name: /Suggestions/ }));
    await user.click(screen.getByRole("link", { name: "Go to transcript turn A2" }));

    expect(screen.getByRole("tab", { name: "Transcript & scorecard" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(document.getElementById("turn-A2")).toHaveFocus());
  });
});

describe("Run report · trace, suggestions and handoff", () => {
  it("shows the Langfuse waterfall with flagged rows and filters them", async () => {
    renderReport({ status: "none" }, { trace: traceFixture() });
    await openTab("Langfuse trace");

    expect(await screen.findByText("Matched by threadId · 3 observations · 1.2k tokens · $0.012")).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "Trace observations" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("llm");
    expect(rows[1]).toHaveTextContent("gpt-6-luna · 1.2k tokens");
    expect(rows[1]).toHaveTextContent("900 ms");
    expect(rows[2]).toHaveAttribute("data-flagged", "true");
    expect(rows[2]).toHaveTextContent("rate lookup failed");

    await userEvent.setup().click(screen.getByRole("checkbox", { name: "Only flagged (1)" }));
    const flagged = within(screen.getByRole("list", { name: "Trace observations" })).getAllByRole("listitem");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toHaveTextContent("check_availability");
  });

  it("explains why there is no trace", async () => {
    renderReport({ status: "none" });
    await openTab("Langfuse trace");

    expect(await screen.findByText("No Langfuse trace for this run")).toBeInTheDocument();
    expect(screen.getByText("The agent has no Langfuse connection.")).toBeInTheDocument();
  });

  it("lists the suggestions as cards with their priority, area and evidence", async () => {
    renderReport(judgementFixture());
    await openTab("Suggestions · 1");

    const suggestions = screen.getByRole("list", { name: "Suggestions" });
    expect(suggestions).toHaveTextContent("High priority");
    expect(suggestions).toHaveTextContent("Prompt");
    expect(within(suggestions).getByRole("heading", { name: "Read the dates back before closing" })).toBeInTheDocument();
    expect(suggestions).toHaveTextContent("Add a confirmation step to the closing instructions.");
    expect(within(suggestions).getByText("R1")).toBeInTheDocument();
  });

  it("copies the brief to the clipboard from the handoff", async () => {
    renderReport(judgementFixture());
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Handoff" }));

    const handoff = screen.getByRole("region", { name: "Handoff to your coding agent" });
    expect(within(handoff).getByRole("region", { name: "Brief for a coding agent" })).toHaveTextContent("# Judge brief");
    await user.click(within(handoff).getByRole("button", { name: "Copy brief" }));

    expect(await navigator.clipboard.readText()).toBe(judgeResultFixture().brief);
    expect(screen.getByText("Brief copied")).toBeInTheDocument();
  });

  describe("download", () => {
    // jsdom has no object URLs; this test installs fakes and the hook puts the originals back.
    const { createObjectURL, revokeObjectURL } = URL;
    afterEach(() => {
      vi.useRealTimers();
      Object.assign(URL, { createObjectURL, revokeObjectURL });
    });

    it("downloads the brief as a Markdown file", async () => {
      const create = vi.fn((blob: Blob) => (blob instanceof Blob ? "blob:brief" : ""));
      const revoke = vi.fn();
      Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
      const clicks: HTMLAnchorElement[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this);
      });
      renderReport(judgementFixture());
      await openTab("Handoff");
      const download = await screen.findByRole("button", { name: "Download .md" });

      // Revoking in the same tick as the click can abort the download, so it waits.
      vi.useFakeTimers();
      fireEvent.click(download);
      expect(clicks).toHaveLength(1);
      expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(REVOKE_BRIEF_URL_MS);

      const blob = create.mock.calls[0][0];
      expect(blob.type).toBe("text/markdown");
      expect(await blob.text()).toBe(judgeResultFixture().brief);
      expect(clicks[0].download).toBe("judge-brief-01234567.md");
      expect(clicks[0].href).toBe("blob:brief");
      expect(revoke).toHaveBeenCalledWith("blob:brief");
    });
  });

  it("explains that the handoff needs a judgement", async () => {
    renderReport({ status: "none" });
    await openTab("Handoff");

    expect(screen.getByText("The brief for a coding agent appears once the run is judged.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy brief" })).not.toBeInTheDocument();
  });

  it("links the trace in Langfuse when the agent's Langfuse host is known", async () => {
    mockLangfuseLookup("a-hotel", "https://cloud.langfuse.com/");
    renderReport({ status: "none" }, { trace: traceFixture() });

    const link = await screen.findByRole("link", { name: /Open trace in Langfuse/ });
    expect(link).toHaveAttribute("href", "https://cloud.langfuse.com/trace/t-1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("omits the Langfuse link without a Langfuse connection", async () => {
    mockLangfuseLookup("a-hotel", null);
    const { queryClient } = renderReport({ status: "none" }, { trace: traceFixture() });
    await screen.findByRole("region", { name: "Call recording" });
    // Wait until the agent (it links no Langfuse connection) was fetched and nothing else loads.
    await waitFor(() => {
      expect(queryClient.getQueryState(["agents"])?.status).toBe("success");
      expect(queryClient.isFetching()).toBe(0);
    });
    expect(screen.queryByRole("link", { name: /Open trace in Langfuse/ })).not.toBeInTheDocument();
  });
});
