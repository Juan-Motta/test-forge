import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n";
import { agentFixture } from "./testing";
import { agentFromText, agentToText } from "./transfer";

const t = createTranslator("en");

describe("agent transfer", () => {
  it("carries a relay agent's session URL there and back", () => {
    const relay = agentFixture({
      protocol: "relay",
      baseUrl: "wss://agent.example.com/api/voice",
      channelId: "",
      userId: null,
      sessionUrl: "https://agent.example.com/api/sessions",
    });
    const text = agentToText(relay, []);
    expect(JSON.parse(text)).toMatchObject({ protocol: "relay", sessionUrl: "https://agent.example.com/api/sessions" });
    const back = agentFromText(t, text, []);
    expect(back.ok && back.values).toMatchObject({ protocol: "relay", sessionUrl: "https://agent.example.com/api/sessions" });
  });

  it("exports no session URL for a Vivi agent", () => {
    expect(JSON.parse(agentToText(agentFixture(), []))).not.toHaveProperty("sessionUrl");
  });
});
