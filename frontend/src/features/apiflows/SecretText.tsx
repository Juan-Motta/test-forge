"use client";

import { Fragment } from "react";
import { useT } from "@/lib/i18n";
import { matchOffsets, secretSegments } from "./run-view";

type SecretTextProps = {
  text: string;
  /** Masked hints by secret name (`••••7890`), from the API's `secrets`. */
  hints: Record<string, string>;
  /** Values in clear by name, while the eye shows them. */
  shown: Record<string, string>;
  /** Text to mark where it appears (a search), case-insensitive. */
  highlight?: string;
};

/** `text` with every case-insensitive occurrence of `query` wrapped in a mark. */
export function Highlighted({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>;
  const parts = [];
  let from = 0;
  for (const at of matchOffsets(text, query)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} data-match className="rounded-sm bg-evaluator/30 text-inherit">
        {text.slice(at, at + query.length)}
      </mark>,
    );
    from = at + query.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts.map((part, index) => (typeof part === "string" ? <Fragment key={`t${index}`}>{part}</Fragment> : part))}</>;
}

/** Text from a run record with each `{{secret.<name>}}` masked as `name ••••hint`, or its value while shown. */
export function SecretText({ text, hints, shown, highlight }: SecretTextProps) {
  const t = useT();
  return (
    <>
      {secretSegments(text).map((segment, index) => {
        if ("text" in segment) return <Highlighted key={index} text={segment.text} query={highlight} />;
        const value = shown[segment.secret];
        if (value !== undefined) {
          return (
            <mark key={index} className="rounded bg-evaluator/15 px-0.5 text-evaluator-fg">
              {value}
            </mark>
          );
        }
        return (
          <span
            key={index}
            title={t("flows.source.secret")}
            className="inline-flex items-center gap-1 rounded-full border border-field-line bg-field px-1.5 align-baseline text-[0.95em]"
          >
            <span className="text-fg">{segment.secret}</span> <span className="text-dim">{hints[segment.secret] ?? "••••"}</span>
          </span>
        );
      })}
    </>
  );
}
