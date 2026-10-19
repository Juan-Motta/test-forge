import { describe, expect, it } from "vitest";
import { localeChoices, localeLabel, voiceChoices } from "./choices";

describe("scenario choices", () => {
  it("names each language in the UI's language", () => {
    expect(localeLabel("es-MX", "en")).toBe("Spanish (Mexico) · es-MX");
    expect(localeLabel("es-MX", "es")).toBe("español (México) · es-MX");
  });

  it("keeps a language the list does not offer", () => {
    const values = localeChoices("es-VE", "en").map((choice) => choice.value);
    expect(values).toContain("es-MX");
    expect(values.at(-1)).toBe("es-VE");
    expect(localeChoices("es-MX", "en").filter((choice) => choice.value === "es-MX")).toHaveLength(1);
  });

  it("offers the given voices plus a stored one they lack", () => {
    expect(voiceChoices(["alloy", "marin"], "")).toEqual(["alloy", "marin"]);
    expect(voiceChoices(["alloy", "marin"], "marin")).toEqual(["alloy", "marin"]);
    expect(voiceChoices(["alloy", "marin"], "nova")).toEqual(["alloy", "marin", "nova"]);
  });
});
