import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockRunsApi, runFixture, batchFixture } from "@/features/runs/testing";
import type { Run } from "@/features/runs/types";
import { installFakeAudio, installFakeSockets } from "@/lib/live/testing";
import { renderWithClient } from "@/test/render";
import { LiveContainer } from "./LiveContainer";
import { FOLLOW_STORAGE_KEY } from "./follow-preference";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const at = (seconds: number) => new Date(Date.now() - 60_000 + seconds * 1000).toISOString();
const live = { endReason: null, endedAt: null } as const;
const booking = runFixture({ id: "r-1", batchId: "b-9", status: "running", startedAt: at(0), ...live });
const cancel = runFixture({
  id: "r-2",
  batchId: "b-9",
  position: 1,
  scenarioId: "s-cancel",
  scenarioName: "Cancel within 24h",
  status: "running",
  startedAt: at(5),
  ...live,
});
const late = runFixture({
  id: "r-4",
  batchId: "b-9",
  position: 3,
  scenarioId: "s-late",
  scenarioName: "Late checkout",
  status: "running",
  startedAt: at(20),
  ...live,
});

let sockets: ReturnType<typeof installFakeSockets>;
let audio: ReturnType<typeof installFakeAudio>;

const toggle = () => screen.getByRole("switch", { name: "Follow and listen automatically" });
const session = (name: RegExp) => within(screen.getByRole("list", { name: "Sessions" })).getByRole("button", { name });
const heading = (name: string) => screen.findByRole("heading", { level: 2, name });

function storeFollow(on: boolean) {
  window.localStorage.setItem(FOLLOW_STORAGE_KEY, on ? "on" : "off");
}

async function overviewOf(runs: Run[]) {
  await waitFor(() => expect(sockets.sockets.some((socket) => socket.url.endsWith("/runs/live?batchId=b-9"))).toBe(true));
  const overview = sockets.sockets.find((socket) => socket.url.endsWith("/runs/live?batchId=b-9"))!;
  act(() => {
    overview.open();
    overview.send({ type: "snapshot", batch: { id: "b-9", status: "running", total: runs.length }, runs });
  });
  return overview;
}

describe("Live sessions: follow and listen automatically", () => {
  beforeEach(() => {
    nav.search = "";
    window.localStorage.clear();
    sockets = installFakeSockets();
    audio = installFakeAudio();
  });
  afterEach(() => {
    sockets.restore();
    audio.restore();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("is off by default and remembers the choice in this browser", async () => {
    mockRunsApi([booking]);
    const first = renderWithClient(<LiveContainer />);
    const user = userEvent.setup();
    expect(await screen.findByRole("switch", { name: "Follow and listen automatically" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await user.click(toggle());
    expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem(FOLLOW_STORAGE_KEY)).toBe("on");
    first.unmount();

    renderWithClient(<LiveContainer />);
    expect(await screen.findByRole("switch", { name: "Follow and listen automatically" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("still toggles when the browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mockRunsApi([booking]);
    renderWithClient(<LiveContainer />);
    const user = userEvent.setup();

    expect(await screen.findByRole("switch", { name: "Follow and listen automatically" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await user.click(toggle());
    expect(toggle()).toHaveAttribute("aria-checked", "true");

    // Leave nothing behind for the next test: storage works again, switch back off.
    vi.restoreAllMocks();
    await user.click(toggle());
    expect(toggle()).toHaveAttribute("aria-checked", "false");
  });

  it("starts listening to the followed call without a click on Listen", async () => {
    storeFollow(true);
    mockRunsApi([booking, cancel]);
    renderWithClient(<LiveContainer />);

    expect(await heading("Booking with date change")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Stop listening" })).toBeInTheDocument();
    expect(audio.contexts).toHaveLength(1);
    expect(audio.contexts[0].state).toBe("running");
  });

  it("stays on the followed run while it is in progress, even when another starts", async () => {
    storeFollow(true);
    const api = mockRunsApi([booking, cancel]);
    const { queryClient } = renderWithClient(<LiveContainer />);
    expect(await heading("Booking with date change")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Stop listening" });

    api.runs = [...api.runs, late];
    await act(() => queryClient.invalidateQueries());
    await waitFor(() => expect(session(/Late checkout/)).toBeInTheDocument());

    expect(session(/Booking with date change/)).toHaveAttribute("aria-pressed", "true");
    expect(audio.contexts).toHaveLength(1);
    expect(audio.contexts[0].closed).toBe(false);
  });

  it("moves to the next run in progress when the followed one ends, and the audio follows", async () => {
    nav.search = "batchId=b-9";
    storeFollow(true);
    mockRunsApi([booking, cancel, late], {
      batches: [batchFixture({ id: "b-9", label: "Hotel regression", status: "running", total: 3 })],
    });
    renderWithClient(<LiveContainer />);
    const overview = await overviewOf([late, cancel, booking]);
    expect(await heading("Booking with date change")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Stop listening" });

    act(() => overview.send({ type: "finished", runId: "r-1", status: "completed", reason: "caller_hung_up" }));

    // The earliest started of the runs still in progress.
    expect(await heading("Cancel within 24h")).toBeInTheDocument();
    expect(session(/Cancel within 24h/)).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("button", { name: "Stop listening" })).toBeInTheDocument();
    expect(audio.contexts).toHaveLength(2);
    expect(audio.contexts[0].closed).toBe(true);
    expect(audio.contexts[1].state).toBe("running");
  });

  it("keeps the ended run when nothing else is in progress, then follows the next one that starts", async () => {
    nav.search = "batchId=b-9";
    storeFollow(true);
    const queued = { ...cancel, status: "queued" as const, startedAt: null };
    mockRunsApi([booking, queued], {
      batches: [batchFixture({ id: "b-9", label: "Hotel regression", status: "running", total: 2 })],
    });
    renderWithClient(<LiveContainer />);
    const overview = await overviewOf([booking, queued]);
    expect(await heading("Booking with date change")).toBeInTheDocument();

    act(() => overview.send({ type: "finished", runId: "r-1", status: "completed", reason: "caller_hung_up" }));
    expect(session(/Booking with date change/)).toHaveAttribute("aria-pressed", "true");

    act(() => overview.send({ type: "status", runId: "r-2", status: "running" }));
    expect(await heading("Cancel within 24h")).toBeInTheDocument();
  });

  it("follows a text run, with no audio", async () => {
    storeFollow(true);
    const chat = runFixture({ id: "r-t", agentKind: "text", status: "running", startedAt: at(0), ...live });
    mockRunsApi([chat]);
    renderWithClient(<LiveContainer />);

    expect(await screen.findByRole("heading", { level: 3, name: "Live conversation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Listen/ })).not.toBeInTheDocument();
    expect(audio.contexts).toHaveLength(0);
  });

  it("asks for a click when the browser refuses to start the audio, without retrying", async () => {
    audio.restore();
    audio = installFakeAudio({ resumeError: new Error("The AudioContext was not allowed to start.") });
    storeFollow(true);
    mockRunsApi([booking]);
    renderWithClient(<LiveContainer />);

    expect(await screen.findByText("The AudioContext was not allowed to start.")).toBeInTheDocument();
    expect(screen.getByText(/needs a click/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listen" })).toBeEnabled();

    // More stream traffic re-renders the panel: still a single attempt.
    const stream = sockets.sockets.find((socket) => socket.url.endsWith("/api/runs/r-1/live"))!;
    act(() => {
      stream.open();
      stream.send({ type: "snapshot", run: { id: "r-1", status: "running" }, transcript: [], turns: [] });
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(audio.contexts).toHaveLength(1);
  });

  it("does not even try before the page got a click, and asks for one", async () => {
    Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: false }, configurable: true });
    try {
      storeFollow(true);
      mockRunsApi([booking]);
      renderWithClient(<LiveContainer />);

      expect(await screen.findByText(/needs a click/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Listen" })).toBeEnabled();
      expect(audio.contexts).toHaveLength(0);
    } finally {
      Reflect.deleteProperty(navigator, "userActivation");
    }
  });

  it("turning it on starts the audio of the focused call right away", async () => {
    mockRunsApi([booking]);
    renderWithClient(<LiveContainer />);
    const user = userEvent.setup();
    expect(await heading("Booking with date change")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Listen" })).toBeInTheDocument();
    expect(audio.contexts).toHaveLength(0);

    await user.click(toggle());

    expect(await screen.findByRole("button", { name: "Stop listening" })).toBeInTheDocument();
    expect(audio.contexts).toHaveLength(1);
  });

  it("when off, neither listens nor moves the focus on its own", async () => {
    nav.search = "batchId=b-9";
    mockRunsApi([booking, cancel], {
      batches: [batchFixture({ id: "b-9", label: "Hotel regression", status: "running", total: 2 })],
    });
    renderWithClient(<LiveContainer />);
    const overview = await overviewOf([booking, cancel]);
    expect(await heading("Booking with date change")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Listen" })).toBeInTheDocument();

    act(() => overview.send({ type: "finished", runId: "r-1", status: "completed", reason: "caller_hung_up" }));

    expect(session(/Booking with date change/)).toHaveAttribute("aria-pressed", "true");
    expect(audio.contexts).toHaveLength(0);
  });
});
