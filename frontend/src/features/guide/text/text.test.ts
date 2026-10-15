// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GUIDE_TEXT, fill } from ".";

/** Every string of a nested dictionary, by its dotted path. */
function flatten(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") out.set(prefix, value);
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      for (const [path, text] of flatten(child, prefix ? `${prefix}.${key}` : key)) out.set(path, text);
    }
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("guide dictionaries", () => {
  const english = flatten(GUIDE_TEXT.en);
  const spanish = flatten(GUIDE_TEXT.es);

  it("define exactly the same keys in every language", () => {
    expect([...spanish.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it("have no empty strings", () => {
    for (const dictionary of [english, spanish]) {
      for (const [key, text] of dictionary) expect(text.trim(), key).not.toBe("");
    }
  });

  it("use the same placeholders in every language", () => {
    for (const [key, text] of english) expect(placeholders(spanish.get(key) ?? ""), key).toEqual(placeholders(text));
  });

  it("translate the visible strings rather than copying the English", () => {
    const same = [...english].filter(([key, text]) => spanish.get(key) === text && /[a-z]{4}/.test(text)).map(([key]) => key);
    // Placeholder-only templates are allowed to match.
    expect(same).toEqual(["callout.titled"]);
  });
});

describe("fill", () => {
  it("replaces known placeholders and leaves unknown ones", () => {
    expect(fill("{title} · Duet guide", { title: "Scoring" })).toBe("Scoring · Duet guide");
    expect(fill("Sample {n} of {total}", { n: 2 })).toBe("Sample 2 of {total}");
  });
});
