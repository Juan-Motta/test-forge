import { fireEvent, render, screen } from "@testing-library/react";
import { Activity, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordingCard } from "./RecordingCard";

const props: ComponentProps<typeof RecordingCard> = {
  conversationSrc: "/api/runs/r-1/audio/conversation",
  conversationDownload: "/api/runs/r-1/audio/conversation?download=1",
  agentSrc: "/api/runs/r-1/audio/agent",
  callerSrc: "/api/runs/r-1/audio/caller",
  levels: undefined,
  levelsProblem: null,
  onReloadLevels: () => undefined,
  pins: [],
  onPin: () => undefined,
  metrics: [],
};

function card(mode: "visible" | "hidden") {
  return (
    <Activity mode={mode}>
      <RecordingCard {...props} />
    </Activity>
  );
}

describe("Recording card playback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("pauses the recording when the page is hidden on navigation", () => {
    // Next keeps visited pages mounted but hidden (<Activity>): a hidden player must not keep playing.
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const view = render(card("visible"));
    const players = [...document.querySelectorAll("audio")];
    expect(players).toHaveLength(3);
    view.rerender(card("hidden"));
    expect(new Set(pause.mock.contexts)).toEqual(new Set(players));
  });

  it("plays one track at a time", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(card("visible"));
    const conversation = screen.getByLabelText("Conversation");
    const agent = screen.getByLabelText("Agent track");
    fireEvent.play(conversation);
    pause.mockClear();
    fireEvent.play(agent);
    expect(pause.mock.contexts).toContain(conversation);
    expect(pause.mock.contexts).not.toContain(agent);
  });
});
