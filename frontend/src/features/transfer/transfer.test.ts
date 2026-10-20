import { describe, expect, it } from "vitest";
import { idByName, parseTransfer, toTransferText, transferFileName } from "./transfer";

describe("config transfer", () => {
  it("tags the text with what it is and its version, and reads it back", () => {
    const text = toTransferText("agent", { name: "Desk" });
    expect(JSON.parse(text)).toEqual({ testforge: "agent", version: 1, name: "Desk" });
    expect(parseTransfer(text, "agent")).toEqual({ ok: true, data: { name: "Desk" } });
    expect(parseTransfer(text, "scenario")).toEqual({ ok: false, error: "kind" });
    expect(parseTransfer("[1]", "agent")).toEqual({ ok: false, error: "json" });
    expect(parseTransfer('{"testforge":"agent","version":2}', "agent")).toEqual({ ok: false, error: "version" });
  });

  it("still reads files exported before the rename, tagged duet", () => {
    expect(parseTransfer('{"duet":"agent","version":1,"name":"Old"}', "agent")).toEqual({ ok: true, data: { name: "Old" } });
  });

  it("names the file after the record", () => {
    expect(transferFileName("scenario", "Intent: invisible under white clothes (es)")).toBe(
      "intent-invisible-under-white-clothes-es.scenario.json",
    );
    expect(transferFileName("agent", "Búsqueda ñ")).toBe("busqueda-n.agent.json");
    expect(transferFileName("agent", "!!!")).toBe("agent.agent.json");
  });

  it("finds a record by name, ignoring case and spaces, only when exactly one matches", () => {
    const records = [
      { id: "1", name: "OpenAI prod" },
      { id: "2", name: "Twin" },
      { id: "3", name: "twin" },
    ];
    expect(idByName(records, "  openai PROD ")).toBe("1");
    expect(idByName(records, "Twin")).toBeUndefined();
    expect(idByName(records, "Missing")).toBeUndefined();
    expect(idByName(records, 42)).toBeUndefined();
  });
});
