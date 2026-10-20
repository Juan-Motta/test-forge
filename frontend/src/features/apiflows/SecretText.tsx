"use client";

import { Fragment } from "react";
import { useT } from "@/lib/i18n";
import { secretSegments } from "./run-view";

type SecretTextProps = {
  text: string;
  /** Masked hints by secret name (`••••7890`), from the API's `secrets`. */
  hints: Record<string, string>;
  /** Values in clear by name, while the eye shows them. */
  shown: Record<string, string>;
};

/** Text from a run record with each `{{secret.<name>}}` masked as `name ••••hint`, or its value while shown. */
export function SecretText({ text, hints, shown }: SecretTextProps) {
  const t = useT();
  return (
    <>
      {secretSegments(text).map((segment, index) => {
        if ("text" in segment) return <Fragment key={index}>{segment.text}</Fragment>;
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
