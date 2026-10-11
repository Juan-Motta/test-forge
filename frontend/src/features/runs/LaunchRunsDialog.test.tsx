import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { LaunchRunsDialog } from "./LaunchRunsDialog";
import { mockRunsApi } from "./testing";

const booking = { id: "s-booking", name: "Booking with date change" };
const cancel = { id: "s-cancel", name: "Cancel within 24h" };

function setup(scenarios = [booking], options: Parameters<typeof mockRunsApi>[1] = {}) {
  const api = mockRunsApi([], options);
  const onLaunched = vi.fn();
  const onClose = vi.fn();
  renderWithClient(<LaunchRunsDialog open scenarios={scenarios} onClose={onClose} onLaunched={onLaunched} />);
  return { api, onLaunched, onClose, user: userEvent.setup() };
}

describe("Launch runs dialog", () => {
  it("launches with the defaults: one run, one at a time, no label", async () => {
    const { api, onLaunched, user } = setup();
    expect(screen.getByRole("dialog", { name: "Launch Booking with date change" })).toBeInTheDocument();
    expect(screen.getByText("1 run")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Launch" }));

    await waitFor(() => expect(onLaunched).toHaveBeenCalledTimes(1));
    expect(api.requests).toEqual([
      { method: "POST", path: "/runs", body: { scenarioIds: ["s-booking"], repetitions: 1, concurrency: 1 } },
    ]);
    expect(onLaunched.mock.calls[0][0]).toMatchObject({ id: "b-new-1", total: 1 });
  });

  it("sends repetitions, concurrency and a trimmed label for several scenarios", async () => {
    const { api, user } = setup([booking, cancel]);
    expect(screen.getByRole("dialog", { name: "Launch 2 scenarios" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Repetitions"));
    await user.type(screen.getByLabelText("Repetitions"), "3");
    await user.clear(screen.getByLabelText("Concurrency"));
    await user.type(screen.getByLabelText("Concurrency"), "2");
    await user.type(screen.getByLabelText("Label (optional)"), "  nightly  ");
    expect(screen.getByText("6 runs")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Launch" }));

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
    await user.clear(screen.getByLabelText("Repetitions"));
    await user.type(screen.getByLabelText("Repetitions"), "11");
    await user.clear(screen.getByLabelText("Concurrency"));
    await user.type(screen.getByLabelText("Concurrency"), "0");
    await user.click(screen.getByRole("button", { name: "Launch" }));

    expect(screen.getByLabelText("Repetitions")).toHaveAccessibleDescription(/between 1 and 10/);
    expect(screen.getByLabelText("Concurrency")).toHaveAccessibleDescription(/between 1 and 10/);
    expect(api.requests).toEqual([]);
  });

  it("names every scenario the backend cannot run, with its reason", async () => {
    const { onLaunched, user } = setup([booking, cancel], {
      notRunnable: { "s-cancel": "the scenario has no voice (TTS) connection" },
    });
    await user.click(screen.getByRole("button", { name: "Launch" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Some scenarios cannot run");
    expect(alert).toHaveTextContent("Cancel within 24h: the scenario has no voice (TTS) connection");
    expect(alert).not.toHaveTextContent("Booking with date change");
    expect(onLaunched).not.toHaveBeenCalled();
  });
});
