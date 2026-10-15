import { describe, expect, it } from "vitest";
import { MESSAGES } from ".";

describe("dictionaries", () => {
  it("define exactly the same keys in every language", () => {
    const english = Object.keys(MESSAGES.en).sort();
    expect(Object.keys(MESSAGES.es).sort()).toEqual(english);
  });

  it("have no empty messages", () => {
    for (const messages of Object.values(MESSAGES)) {
      for (const [key, value] of Object.entries(messages)) expect(value.trim(), key).not.toBe("");
    }
  });

  it("use the same placeholders in every language", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [key, value] of Object.entries(MESSAGES.en)) {
      expect(placeholders(MESSAGES.es[key as keyof typeof MESSAGES.en]), key).toEqual(placeholders(value));
    }
  });
});
