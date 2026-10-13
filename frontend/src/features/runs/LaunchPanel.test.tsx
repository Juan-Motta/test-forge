import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { LaunchPanel } from "./LaunchPanel";
import { mockRunsApi } from "./testing";

const booking = { id: "s-booking", name: "Booking with date change", maxDurationS: 360 };

function setup(props: Partial<Parameters<typeof LaunchPanel>[0]> = {}) {
  const api = mockRunsApi([]);
  const onLaunched = vi.fn();
  renderWithClient(<LaunchPanel scenarios={[booking]} onLaunched={onLaunched} {...props} />);
  return { api, onLaunched, user: userEvent.setup() };
}

describe("Launch panel", () => {
  it("scopes one scenario, estimates calls and wall time, and launches", async () => {
    const { api, onLaunched, user } = setup();

    const scope = screen.getByRole("radiogroup", { name: "What to run" });
    expect(within(scope).getByRole("radio", { name: "This scenario" })).toBeChecked();
    const judge = screen.getByRole("checkbox", { name: "Judge automatically when each call ends" });
    expect(judge).toBeChecked();
    expect(judge).toBeDisabled();

    await user.clear(screen.getByLabelText("Runs each"));
    await user.type(screen.getByLabelText("Runs each"), "3");
    await user.clear(screen.getByLabelText("In parallel"));
    await user.type(screen.getByLabelText("In parallel"), "3");
    expect(screen.getByText("3 calls")).toBeInTheDocument();
    expect(screen.getByText("≈ 6 min wall time")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Launch 3 runs" }));

    await waitFor(() => expect(onLaunched).toHaveBeenCalledTimes(1));
    expect(api.requests[0].body).toEqual({ scenarioIds: ["s-booking"], repetitions: 3, concurrency: 3 });
  });

  it("estimates sequential waves when fewer run in parallel", async () => {
    const { user } = setup();
    await user.clear(screen.getByLabelText("Runs each"));
    await user.type(screen.getByLabelText("Runs each"), "4");
    await user.clear(screen.getByLabelText("In parallel"));
    await user.type(screen.getByLabelText("In parallel"), "2");

    expect(screen.getByText("4 calls")).toBeInTheDocument();
    expect(screen.getByText("≈ 12 min wall time")).toBeInTheDocument();
  });

  it("offers no Cancel when its host has nothing to close", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("counts conversations for text scenarios and runs for a mixed batch", () => {
    const chat = { id: "s-chat", name: "Chat refund", maxDurationS: 360, kind: "text" as const };
    const { unmount } = renderWithClient(<LaunchPanel scenarios={[chat]} onLaunched={vi.fn()} />);
    expect(screen.getByText("1 conversation")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Judge automatically when each conversation ends" })).toBeChecked();
    unmount();

    renderWithClient(<LaunchPanel scenarios={[chat, { ...booking, kind: "voice" }]} onLaunched={vi.fn()} />);
    expect(screen.getByText("2 runs")).toBeInTheDocument();
  });
});
