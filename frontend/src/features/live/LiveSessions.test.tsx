import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockRunsApi, runFixture, batchFixture } from "@/features/runs/testing";
import { installFakeAudio, installFakeSockets } from "@/lib/live/testing";
import { renderWithClient } from "@/test/render";
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
});
