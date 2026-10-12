import { describe, expect, it } from "vitest";
import { baseUrlProblem, originProblem, toChanges, toNewAgent, initialValues } from "./form-schema";
import { agentFixture } from "./testing";

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
    expect(baseUrlProblem(value)).toBe(problem);
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
    expect(originProblem(value)).toBe(problem);
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
