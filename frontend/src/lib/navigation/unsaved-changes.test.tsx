import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { confirmLeave, useUnsavedChangesGuard } from "./unsaved-changes";

function unload(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("useUnsavedChangesGuard", () => {
  it("lets navigation through without asking while nothing is dirty", () => {
    const confirm = vi.spyOn(window, "confirm");
    renderHook(() => useUnsavedChangesGuard(false));

    expect(confirmLeave()).toBe(true);
    expect(unload()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks before leaving while dirty and stops asking once unmounted", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true, "Discard?"));

    expect(confirmLeave()).toBe(false);
    expect(confirm).toHaveBeenCalledWith("Discard?");
    expect(unload()).toBe(true);

    unmount();
    expect(confirmLeave()).toBe(true);
    expect(unload()).toBe(false);
  });
});
