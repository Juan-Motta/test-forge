import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";

describe("CodeBlock", () => {
  it("shows the code in a focusable, labelled pre without a copy button by default", () => {
    render(<CodeBlock code={"# Brief\nFix the rate"} label="Handoff brief" />);

    const pre = screen.getByRole("region", { name: "Handoff brief" });
    expect(pre.tagName).toBe("PRE");
    expect(pre).toHaveAttribute("tabindex", "0");
    expect(pre).toHaveTextContent("# Brief Fix the rate");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("copies the code and confirms it", async () => {
    const user = userEvent.setup();
    render(<CodeBlock code="curl /api/runs" label="Command" copyable />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await navigator.clipboard.readText()).toBe("curl /api/runs");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });

  describe("with fake timers", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Clicks Copy and lets the clipboard promise settle (only the timeouts are faked). */
    async function copy() {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      });
    }

    function setup() {
      userEvent.setup(); // installs the clipboard stub
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      render(<CodeBlock code="curl /api/runs" label="Command" copyable />);
      return screen.getByRole("status");
    }

    it("returns to idle after about two seconds and announces again on a repeated copy", async () => {
      const status = setup();

      await copy();
      expect(status).toHaveTextContent("Copied");

      act(() => {
        vi.advanceTimersByTime(2100);
      });
      expect(status.textContent).toBe("");

      await copy();
      expect(status).toHaveTextContent("Copied");
    });

    it("clears the message before re-announcing a copy made while it still shows", async () => {
      const status = setup();
      await copy();
      const seen: string[] = [];
      const observer = new MutationObserver(() => seen.push(status.textContent ?? ""));
      observer.observe(status, { childList: true, characterData: true, subtree: true });

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      await copy();
      observer.disconnect();

      expect(seen).toContain("");
      expect(status).toHaveTextContent("Copied");
      // The second copy restarts the two-second window.
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(status).toHaveTextContent("Copied");
    });
  });

  it("reports a failed copy", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    render(<CodeBlock code="curl /api/runs" label="Command" copyable />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByText("Copy failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
  });
});
