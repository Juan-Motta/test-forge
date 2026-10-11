import { describe, expect, it } from "vitest";
import { canChat } from "./kinds";

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
