import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

/** The `--ve-*` declarations of the first rule body after `marker`, in order. */
function tokensAfter(marker: string): string[] {
  const start = css.indexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", css.indexOf(":root", start));
  const close = css.indexOf("}", open);
  return css
    .slice(open + 1, close)
    .split(";")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("--ve-"));
}

describe("light palette", () => {
  it("is the same for the Light choice and for a light system preference", () => {
    const forced = tokensAfter(':root[data-theme="light"]');
    const system = tokensAfter("@media (prefers-color-scheme: light)");
    expect(forced.length).toBeGreaterThan(30);
    expect(system).toEqual(forced);
  });
});
