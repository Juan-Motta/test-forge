import { describe, expect, it } from "vitest";
import { endReasonRepeatsStatus } from "./format";

describe("endReasonRepeatsStatus", () => {
  it("says a cancelled run's cancelled reason only repeats its status", () => {
    expect(endReasonRepeatsStatus("cancelled", "cancelled")).toBe(true);
  });

  it("keeps a reason that adds something to the status", () => {
    expect(endReasonRepeatsStatus("failed", "connect_failed")).toBe(false);
    expect(endReasonRepeatsStatus("interrupted", "server_restarted")).toBe(false);
    expect(endReasonRepeatsStatus("failed", "cancelled")).toBe(false);
    expect(endReasonRepeatsStatus("cancelled", null)).toBe(false);
  });
});
