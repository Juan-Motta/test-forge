import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw/http";
import { mockRunsApi, runFixture, batchFixture } from "@/features/runs/testing";
import type { Run } from "@/features/runs/types";
import { installFakeAudio, installFakeSockets } from "@/lib/live/testing";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { LiveContainer } from "./LiveContainer";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const now = new Date().toISOString();
const booking = runFixture({ id: "r-1", batchId: "b-9", status: "running", endReason: null, endedAt: null, startedAt: now, createdAt: "2026-10-05T10:00:00Z" });
const cancel = runFixture({
  id: "r-2",
  batchId: "b-9",
  position: 1,
  scenarioId: "s-cancel",
  scenarioName: "Cancel within 24h",
  status: "connecting",
  endReason: null,
  endedAt: null,
  startedAt: now,
  createdAt: "2026-10-05T10:00:00Z",
});
const queued = runFixture({
  id: "r-3",
  batchId: "b-9",
  position: 2,
  scenarioName: "Group booking",
  status: "queued",
  endReason: null,
  startedAt: null,
  endedAt: null,
  createdAt: "2026-10-05T10:00:00Z",
});

let sockets: ReturnType<typeof installFakeSockets>;
let audio: ReturnType<typeof installFakeAudio>;

const socketFor = (path: string) => sockets.sockets.filter((socket) => socket.url.endsWith(path));
const session = (name: RegExp) => within(screen.getByRole("list", { name: "Sessions" })).getByRole("button", { name });

describe("Live sessions", () => {
  beforeEach(() => {
    nav.search = "";
    sockets = installFakeSockets();
    audio = installFakeAudio();
  });
  afterEach(() => {
    sockets.restore();
    audio.restore();
  });

  it("lists the active runs and focuses the first one in progress", async () => {
    mockRunsApi([booking, cancel, queued, runFixture({ id: "r-old" })]);
    renderWithClient(<LiveContainer />);
    const user = userEvent.setup();

    await waitFor(() => expect(within(screen.getByRole("list", { name: "Sessions" })).getAllByRole("button")).toHaveLength(3));
    expect(session(/Group booking/)).toHaveTextContent("Starts when a slot frees up");
    expect(session(/Booking with date change/)).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("heading", { level: 2, name: "Booking with date change" })).toBeInTheDocument();
    await waitFor(() => expect(socketFor("/api/runs/r-1/live")).toHaveLength(1));

    await user.click(session(/Cancel within 24h/));
    expect(await screen.findByRole("heading", { level: 2, name: "Cancel within 24h" })).toBeInTheDocument();
    await waitFor(() => expect(socketFor("/api/runs/r-2/live")).toHaveLength(1));
    expect(socketFor("/api/runs/r-1/live")[0].closedByClient).toBe(true);
  });

  it("follows a batch over its overview stream", async () => {
    nav.search = "batchId=b-9";
    mockRunsApi([booking, cancel, queued], {
      batches: [batchFixture({ id: "b-9", label: "Hotel regression", status: "running", total: 3, concurrency: 2 })],
    });
    renderWithClient(<LiveContainer />);

    await waitFor(() => expect(socketFor("/api/runs/live?batchId=b-9")).toHaveLength(1));
    const overview = socketFor("/api/runs/live?batchId=b-9")[0];
    act(() => {
      overview.open();
      overview.send({
        type: "snapshot",
        batch: { id: "b-9", status: "running", total: 3 },
        runs: [booking, cancel, queued],
      });
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Hotel regression" })).toBeInTheDocument();
    expect(screen.getByText("Concurrency 2 · 3 runs")).toBeInTheDocument();

    act(() => {
      overview.send({ type: "finished", runId: "r-2", status: "failed", reason: "tts_failed" });
      overview.send({ type: "status", runId: "r-3", status: "connecting" });
    });
    expect(session(/Cancel within 24h/)).toHaveTextContent("Failed");
    expect(session(/Cancel within 24h/)).toHaveTextContent("Speech synthesis failed");
    expect(session(/Group booking/)).toHaveTextContent("Connecting");
    expect(screen.getByText("1 finished")).toBeInTheDocument();

    act(() => overview.send({ type: "batchFinished", batchId: "b-9" }));
    expect(screen.getByText("Batch finished")).toBeInTheDocument();
  });

  it("cancels the whole batch", async () => {
    nav.search = "batchId=b-9";
    const api = mockRunsApi([booking, cancel, queued], {
      batches: [batchFixture({ id: "b-9", label: "Hotel regression", status: "running", total: 3 })],
    });
    renderWithClient(<LiveContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Stop all" }));
    await waitFor(() =>
      expect(api.requests).toContainEqual({ method: "POST", path: "/runs/batches/b-9/cancel", body: undefined }),
    );
  });

  it("says when no call is in progress", async () => {
    mockRunsApi([runFixture()]);
    renderWithClient(<LiveContainer />);
    expect(await screen.findByText("No calls in progress")).toBeInTheDocument();
    expect(sockets.sockets).toHaveLength(0);
  });

  it("keeps showing the sessions that loaded when one poll fails", async () => {
    mockRunsApi([booking, cancel, queued]);
    server.use(
      http.get(apiUrl("/runs"), ({ request }) =>
        new URL(request.url).searchParams.get("status") === "connecting"
          ? HttpResponse.json({ detail: "Database unavailable" }, { status: 500 })
          : undefined,
      ),
    );
    renderWithClient(<LiveContainer />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Some live sessions could not be loaded");
    expect(alert).toHaveTextContent("Database unavailable");
    const cards = within(screen.getByRole("list", { name: "Sessions" })).getAllByRole("button");
    expect(cards).toHaveLength(2);
    expect(session(/Booking with date change/)).toBeInTheDocument();
    expect(session(/Group booking/)).toBeInTheDocument();
  });

  it("keeps the automatically focused run when it ends, until another is picked", async () => {
    const api = mockRunsApi([booking, cancel, queued]);
    const { queryClient } = renderWithClient(<LiveContainer />);
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 2, name: "Booking with date change" })).toBeInTheDocument();

    await finish(api, queryClient, "r-1");

    expect(session(/Booking with date change/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Booking with date change" })).toBeInTheDocument();

    await user.click(session(/Cancel within 24h/));
    expect(await screen.findByRole("heading", { level: 2, name: "Cancel within 24h" })).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Sessions" })).getAllByRole("button")).toHaveLength(2));
  });

  it("keeps the picked run when it ends", async () => {
    const api = mockRunsApi([booking, cancel, queued]);
    const { queryClient } = renderWithClient(<LiveContainer />);
    const user = userEvent.setup();
    await user.click(await within(await screen.findByRole("list", { name: "Sessions" })).findByRole("button", { name: /Cancel within 24h/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Cancel within 24h" })).toBeInTheDocument();

    await finish(api, queryClient, "r-2");

    expect(session(/Cancel within 24h/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Cancel within 24h" })).toBeInTheDocument();
  });

  it("keeps the focused run of a batch when it finishes", async () => {
    nav.search = "batchId=b-9";
    mockRunsApi([booking, cancel, queued], {
      batches: [batchFixture({ id: "b-9", label: "Hotel regression", status: "running", total: 3 })],
    });
    renderWithClient(<LiveContainer />);
    expect(await screen.findByRole("heading", { level: 2, name: "Booking with date change" })).toBeInTheDocument();
    const overview = socketFor("/api/runs/live?batchId=b-9")[0];
    act(() => {
      overview.open();
      overview.send({ type: "snapshot", batch: { id: "b-9", status: "running", total: 3 }, runs: [booking, cancel, queued] });
      overview.send({ type: "finished", runId: "r-1", status: "completed", reason: "caller_hung_up" });
    });

    expect(session(/Booking with date change/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Booking with date change" })).toBeInTheDocument();
  });
});

/** The run ends on the backend and the next poll no longer lists it as active. */
async function finish(
  api: ReturnType<typeof mockRunsApi>,
  queryClient: { invalidateQueries: () => Promise<void> },
  id: string,
) {
  api.runs = api.runs.map((run): Run => (run.id === id ? { ...run, status: "completed", endReason: "caller_hung_up" } : run));
  const before = api.listQueries.length;
  await act(() => queryClient.invalidateQueries());
  await waitFor(() => expect(api.listQueries.length).toBeGreaterThanOrEqual(before + 3));
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Sessions" })).queryByRole("button", { name: /Group booking/ })).toBeInTheDocument());
}
