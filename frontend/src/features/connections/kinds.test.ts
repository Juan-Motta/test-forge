import { describe, expect, it } from "vitest";
import { KINDS, canChat, canVoice } from "./kinds";

describe("canChat", () => {
  it("accepts OpenAI always and Azure OpenAI only with a chat deployment", () => {
    expect(canChat({ kind: "openai", config: {} })).toBe(true);
    expect(canChat({ kind: "azure_openai", config: { ttsDeployment: "tts" } })).toBe(false);
    expect(canChat({ kind: "azure_openai", config: { chatDeployment: null } })).toBe(false);
    expect(canChat({ kind: "azure_openai", config: { chatDeployment: "chat" } })).toBe(true);
    expect(canChat({ kind: "azure_speech", config: {} })).toBe(false);
    expect(canChat({ kind: "langfuse", config: {} })).toBe(false);
  });
});

describe("canVoice", () => {
  it("is true only for the kinds that declare the evaluator's voices", () => {
    expect(canVoice({ kind: "openai" })).toBe(true);
    expect(canVoice({ kind: "azure_openai" })).toBe(true);
    expect(canVoice({ kind: "azure_speech" })).toBe(false);
    expect(canVoice({ kind: "langfuse" })).toBe(false);
  });

  it("gives OpenAI's TTS voices to the pipeline and only the realtime voices to the realtime evaluator", () => {
    expect(KINDS.openai.voices?.pipeline).toContain("nova");
    expect(KINDS.openai.voices?.realtime).not.toContain("nova");
    expect(KINDS.azure_openai.voices).toEqual(KINDS.openai.voices);
  });
});
