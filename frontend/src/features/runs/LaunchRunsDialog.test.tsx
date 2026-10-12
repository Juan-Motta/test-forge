import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { LaunchRunsDialog } from "./LaunchRunsDialog";
import { batchFixture, mockRunsApi } from "./testing";
import type { BatchDetail } from "./types";

/** The submit button, named after the planned runs ("Launch 1 run", "Launch 6 runs"). */
const LAUNCH = /^Launch (\d+ runs?|runs)$/;

const booking = { id: "s-booking", name: "Booking with date change" };
const cancel = { id: "s-cancel", name: "Cancel within 24h" };

function setup(scenarios = [booking], options: Parameters<typeof mockRunsApi>[1] = {}) {
  const api = mockRunsApi([], options);
  const onLaunched = vi.fn();
  const onClose = vi.fn();
  renderWithClient(<LaunchRunsDialog open scenarios={scenarios} onClose={onClose} onLaunched={onLaunched} />);
  return { api, onLaunched, onClose, user: userEvent.setup() };
}

/** Holds `POST /runs` until `release()`; counts every attempt. */
function holdLaunch() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const state = { posts: 0, release: () => release() };
  server.use(
    http.post(apiUrl("/runs"), async () => {
      state.posts += 1;
      await gate;
      return HttpResponse.json({ ...batchFixture({ id: "b-held" }), runs: [] }, { status: 201 });
    }),
  );
  return state;
}

/** The dialog as a page uses it: open state lives in the parent and `onClose` unmounts it. */
function Host({ onLaunched }: { onLaunched: (batch: BatchDetail) => void }) {
  const [open, setOpen] = useState(true);
  return <LaunchRunsDialog open={open} scenarios={[booking]} onClose={() => setOpen(false)} onLaunched={onLaunched} />;
}

describe("Launch runs dialog", () => {
  it("launches with the defaults: one run, one at a time, no label", async () => {
    const { api, onLaunched, user } = setup();
    expect(screen.getByRole("dialog", { name: "Launch Booking with date change" })).toBeInTheDocument();
    expect(screen.getByText("1 call")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: LAUNCH }));

    await waitFor(() => expect(onLaunched).toHaveBeenCalledTimes(1));
    expect(api.requests).toEqual([
      { method: "POST", path: "/runs", body: { scenarioIds: ["s-booking"], repetitions: 1, concurrency: 1 } },
    ]);
    expect(onLaunched.mock.calls[0][0]).toMatchObject({ id: "b-new-1", total: 1 });
  });

  it("sends repetitions, concurrency and a trimmed label for several scenarios", async () => {
    const { api, user } = setup([booking, cancel]);
    expect(screen.getByRole("dialog", { name: "Launch 2 scenarios" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Runs each"));
    await user.type(screen.getByLabelText("Runs each"), "3");
    await user.clear(screen.getByLabelText("In parallel"));
    await user.type(screen.getByLabelText("In parallel"), "2");
    await user.type(screen.getByLabelText("Label (optional)"), "  nightly  ");
    expect(screen.getByText("6 calls")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: LAUNCH }));

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0].body).toEqual({
      scenarioIds: ["s-booking", "s-cancel"],
      repetitions: 3,
      concurrency: 2,
      label: "nightly",
    });
  });

  it("refuses repetitions or concurrency outside 1-10 without calling the API", async () => {
    const { api, user } = setup();
    await user.clear(screen.getByLabelText("Runs each"));
    await user.type(screen.getByLabelText("Runs each"), "11");
    await user.clear(screen.getByLabelText("In parallel"));
    await user.type(screen.getByLabelText("In parallel"), "0");
    await user.click(screen.getByRole("button", { name: LAUNCH }));

    expect(screen.getByLabelText("Runs each")).toHaveAccessibleDescription(/between 1 and 10/);
    expect(screen.getByLabelText("In parallel")).toHaveAccessibleDescription(/between 1 and 10/);
    expect(api.requests).toEqual([]);
  });

  it("names every scenario the backend cannot run, with its reason", async () => {
    const { onLaunched, user } = setup([booking, cancel], {
      notRunnable: { "s-cancel": "the scenario has no voice (TTS) connection" },
    });
    await user.click(screen.getByRole("button", { name: LAUNCH }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Some scenarios cannot run");
    expect(alert).toHaveTextContent("Cancel within 24h: the scenario has no voice (TTS) connection");
    expect(alert).not.toHaveTextContent("Booking with date change");
    expect(onLaunched).not.toHaveBeenCalled();
  });

  it("sends one launch for a double click", async () => {
    const held = holdLaunch();
    const onLaunched = vi.fn();
    renderWithClient(<Host onLaunched={onLaunched} />);
    const user = userEvent.setup();

    await user.dblClick(screen.getByRole("button", { name: LAUNCH }));
    await waitFor(() => expect(held.posts).toBe(1));
    held.release();

    await waitFor(() => expect(onLaunched).toHaveBeenCalledTimes(1));
    expect(held.posts).toBe(1);
  });

  it("cannot be closed while launching, and still redirects once the batch exists", async () => {
    const held = holdLaunch();
    const onLaunched = vi.fn();
    renderWithClient(<Host onLaunched={onLaunched} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: LAUNCH }));
    await waitFor(() => expect(held.posts).toBe(1));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Launch Booking with date change" })).toBeInTheDocument();

    held.release();
    await waitFor(() => expect(onLaunched).toHaveBeenCalledTimes(1));
    expect(onLaunched.mock.calls[0][0]).toMatchObject({ id: "b-held" });
    expect(held.posts).toBe(1);
  });

  it.each([
    [400, "Bad launch request"],
    [500, "Launcher crashed"],
  ])("shows a %i failure and lets you retry", async (status, detail) => {
    let fail = true;
    const api = mockRunsApi([]);
    server.use(
      http.post(apiUrl("/runs"), () =>
        fail ? HttpResponse.json({ detail }, { status }) : undefined,
      ),
    );
    const onLaunched = vi.fn();
    renderWithClient(<Host onLaunched={onLaunched} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: LAUNCH }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not launch");
    expect(alert).toHaveTextContent(detail);
    expect(onLaunched).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

    fail = false;
    await user.click(screen.getByRole("button", { name: LAUNCH }));
    await waitFor(() => expect(onLaunched).toHaveBeenCalledTimes(1));
    expect(api.requests).toHaveLength(1);
  });
});
