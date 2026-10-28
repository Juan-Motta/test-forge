import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n";
import { agentFormSchema, baseUrlProblem, originProblem, toChanges, toNewAgent, initialValues } from "./form-schema";
import { agentFixture } from "./testing";

const t = createTranslator("en");

describe("baseUrlProblem", () => {
  it.each([
    ["wss://agent.example.com/ws", undefined],
    ["ws://localhost:8080/ws", undefined],
    ["ws://127.0.0.1/ws", undefined],
    ["ws://localhost:8000", undefined],
    ["ws://host.docker.internal:8000", undefined],
    ["ws://docker.internal:8000", "URL must use wss://."],
    ["ws://agent.example.com/ws", "URL must use wss://."],
    ["https://agent.example.com", "URL must use wss://."],
    ["wss://user:pw@agent.example.com", "URL must not contain credentials."],
    ["wss://agent.example.com/ws?x=1", "URL must not contain a query string or fragment."],
    ["wss://agent.example.com/ws#a", "URL must not contain a query string or fragment."],
    ["wss://agent example.com", "URL must not contain spaces, backslashes or control characters."],
    ["agent.example.com", "URL must be absolute and name a host."],
  ])("%s → %s", (value, problem) => {
    expect(baseUrlProblem(t, value)).toBe(problem);
  });
});

describe("originProblem", () => {
  it.each([
    ["https://app.example.com", undefined],
    ["http://localhost:3000", undefined],
    ["https://app.example.com/", undefined],
    ["https://app.example.com/path", "Origin must be only scheme, host and port."],
    ["wss://app.example.com", "Origin must use https or http."],
  ])("%s → %s", (value, problem) => {
    expect(originProblem(t, value)).toBe(problem);
  });
});

describe("toChanges", () => {
  it("turns a cleared optional field into null and keeps unchanged fields out", () => {
    const agent = agentFixture({ origin: "https://app.example.com", langfuseConnectionId: "c-lf" });
    const values = { ...initialValues(agent), origin: " ", langfuseConnectionId: "", name: " Renamed " };

    expect(toChanges(agent, values)).toEqual({ name: "Renamed", origin: null, langfuseConnectionId: null });
    expect(toNewAgent(initialValues(agent)).origin).toBe("https://app.example.com");
  });
});

describe("text agents", () => {
  const textAgent = agentFixture({
    id: "a-chat",
    kind: "text",
    protocol: "auto",
    baseUrl: "https://api.example.com",
    channelId: "2a8204d3-bd82-4799-a8e8-8e669f318fec",
    userId: null,
    textMode: "stream",
    auth: "api_key",
    hasApiKey: true,
    apiKeyHint: "••••1234",
  });
  const textValues = (overrides: Partial<ReturnType<typeof initialValues>> = {}) => ({
    ...initialValues(),
    name: "Chat desk",
    kind: "text" as const,
    baseUrl: "https://api.example.com",
    channelId: "2a8204d3-bd82-4799-a8e8-8e669f318fec",
    ...overrides,
  });
  const problems = (values: ReturnType<typeof initialValues>, hasStoredKey = false) => {
    const result = agentFormSchema(t, hasStoredKey).safeParse(values);
    return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
  };

  it.each([
    ["https://api.example.com", undefined],
    ["http://localhost:8000", undefined],
    ["http://api.example.com", "URL must use https://."],
    ["wss://api.example.com", "URL must use https://."],
  ])("text base URL %s → %s", (value, problem) => {
    expect(baseUrlProblem(t, value, "text")).toBe(problem);
  });

  it("needs a UUID channel and no user ID", () => {
    expect(problems(textValues())).toEqual({});
    expect(problems(textValues({ channelId: "hotel-dev" }))).toEqual({ channelId: "Use the channel's UUID." });
  });

  it("asks for an API key only when none is stored", () => {
    expect(problems(textValues({ auth: "api_key" }))).toEqual({ apiKey: "Enter the API key." });
    expect(problems(textValues({ auth: "api_key" }), true)).toEqual({});
  });

  it("creates with the text fields only, defaulting to stream without auth", () => {
    expect(toNewAgent(textValues({ origin: "https://portal.example.com" }))).toEqual({
      name: "Chat desk",
      context: "",
      kind: "text",
      baseUrl: "https://api.example.com",
      channelId: "2a8204d3-bd82-4799-a8e8-8e669f318fec",
      textMode: "stream",
      auth: "none",
      origin: "https://portal.example.com",
      langfuseConnectionId: null,
    });
    expect(toNewAgent(textValues({ auth: "api_key", apiKey: " sk-1 " }))).toMatchObject({ auth: "api_key", apiKey: "sk-1" });
  });

  it("sends a new API key only when one was typed", () => {
    const values = initialValues(textAgent);
    expect(values.kind).toBe("text");
    expect(toChanges(textAgent, values)).toEqual({});
    expect(toChanges(textAgent, { ...values, apiKey: "sk-new", textMode: "invoke" })).toEqual({
      textMode: "invoke",
      apiKey: "sk-new",
    });
    expect(toChanges(textAgent, { ...values, auth: "none" })).toEqual({ auth: "none" });
  });

  it("creates a voice agent with kind voice and no text fields", () => {
    expect(toNewAgent(initialValues(agentFixture()))).toEqual({
      name: "Hotel booking assistant",
      context: "Voice receptionist of Hotel Mirador. Books, changes and cancels reservations.",
      kind: "voice",
      protocol: "realtime",
      baseUrl: "wss://agent.example.com/ws",
      channelId: "hotel-dev",
      userId: "user|KSG|42",
      sessionUrl: null,
      origin: null,
      langfuseConnectionId: null,
    });
  });
});

describe("relay agents", () => {
  const relayValues = (overrides: Partial<ReturnType<typeof initialValues>> = {}) => ({
    ...initialValues(),
    name: "Portfolio voice",
    protocol: "relay" as const,
    baseUrl: "wss://agent.raaw.dev/api/voice",
    sessionUrl: "https://agent.raaw.dev/api/sessions",
    origin: "https://raaw.dev",
    ...overrides,
  });
  const problems = (values: ReturnType<typeof initialValues>) => {
    const result = agentFormSchema(t).safeParse(values);
    return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
  };

  it("needs no channel or user, and an optional https session URL on the agent's host", () => {
    expect(problems(relayValues())).toEqual({});
    expect(problems(relayValues({ sessionUrl: "" }))).toEqual({});
    expect(problems(relayValues({ sessionUrl: "wss://agent.raaw.dev/api/sessions" }))).toEqual({
      sessionUrl: "URL must use https://.",
    });
    expect(problems(relayValues({ sessionUrl: "https://other.example.com/sessions" }))).toEqual({
      sessionUrl: "Use the same host as the WebSocket URL.",
    });
  });

  it("creates without a channel or user, with the session URL", () => {
    expect(toNewAgent(relayValues({ channelId: "left-over", userId: "left-over" }))).toEqual({
      name: "Portfolio voice",
      context: "",
      kind: "voice",
      protocol: "relay",
      baseUrl: "wss://agent.raaw.dev/api/voice",
      userId: null,
      sessionUrl: "https://agent.raaw.dev/api/sessions",
      origin: "https://raaw.dev",
      langfuseConnectionId: null,
    });
    expect(toNewAgent(relayValues({ sessionUrl: " " }))).toMatchObject({ sessionUrl: null });
  });

  it("clears the session URL when the agent moves to a Vivi protocol", () => {
    const relay = agentFixture({ protocol: "relay", channelId: "", userId: null, sessionUrl: "https://agent.example.com/s" });
    const values = { ...initialValues(relay), protocol: "live" as const, channelId: "c-1", userId: "u-1" };
    expect(toChanges(relay, values)).toEqual({ protocol: "live", channelId: "c-1", userId: "u-1", sessionUrl: null });
  });
});
