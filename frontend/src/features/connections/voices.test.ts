import { describe, expect, it } from "vitest";
import { lacksKnownVoice, ttsVoicesFor, withCurrent } from "./voices";

describe("voices", () => {
  it("judges only OpenAI voices: one the model lacks, not a custom or blank one", () => {
    const legacy = ttsVoicesFor("tts-1");
    expect(lacksKnownVoice(legacy, "marin")).toBe(true);
    expect(lacksKnownVoice(legacy, "nova")).toBe(false);
    expect(lacksKnownVoice(legacy, "aurora")).toBe(false);
    expect(lacksKnownVoice(legacy, "")).toBe(false);
    expect(lacksKnownVoice(ttsVoicesFor("gpt-4o-mini-tts"), "marin")).toBe(false);
  });

  it("keeps a current value the options lack, once", () => {
    expect(withCurrent(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(withCurrent(["a", "b"], "b")).toEqual(["a", "b"]);
    expect(withCurrent(["a", "b"], null)).toEqual(["a", "b"]);
  });
});
