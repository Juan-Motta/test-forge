import { describe, expect, it } from "vitest";
import { entriesFromRows } from "./transcript";

describe("entriesFromRows", () => {
  it("keeps a caller line's reason as its intent, but not the realtime placeholder", () => {
    const entries = entriesFromRows([
      { role: "caller", text: "I need a room", reason: "opening: state the goal" },
      { role: "caller", text: "Two nights", reason: "realtime" },
    ]);
    expect(entries.map((entry) => entry.intent)).toEqual(["opening: state the goal", undefined]);
  });
});
