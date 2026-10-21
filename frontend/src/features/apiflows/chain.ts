import type { FlowStep } from "./types";

const PLACEHOLDER = /\{\{\s*([A-Za-z_]+)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Where a step puts a value: its path, a query parameter, a header or a spot in its JSON body. */
export type ChainUse = { step: number; where: "path" | "query" | "header" | "body"; name: string };

/** A value one step reads from its response and later steps send on. */
export type ChainLink = { name: string; from: number; path: string; uses: ChainUse[] };

function usesIn(step: FlowStep, index: number): { name: string; use: ChainUse }[] {
  const found: { name: string; use: ChainUse }[] = [];
  const scan = (text: string, where: ChainUse["where"], name: string) => {
    for (const match of text.matchAll(PLACEHOLDER)) {
      if (match[1] === "saved") found.push({ name: match[2], use: { step: index, where, name } });
    }
  };
  scan(step.path, "path", "");
  step.query.forEach((param) => scan(param.value, "query", param.name));
  step.headers.forEach((header) => scan(header.value, "header", header.name));
  const walk = (value: unknown, at: string) => {
    if (typeof value === "string") scan(value, "body", at);
    else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${at}[${i}]`));
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([key, item]) => walk(item, at ? `${at}.${key}` : key));
  };
  walk(step.body, "");
  return found;
}

/** What chains the steps: every saved value, the step that saves it (and from where in its
 * response), and each later step that sends it (and where in its request). */
export function flowChain(steps: FlowStep[]): ChainLink[] {
  const links: ChainLink[] = [];
  steps.forEach((step, index) =>
    step.saves.forEach((save) => links.push({ name: save.name, from: index, path: save.path, uses: [] })),
  );
  steps.forEach((step, index) => {
    for (const { name, use } of usesIn(step, index)) links.find((link) => link.name === name)?.uses.push(use);
  });
  return links;
}
