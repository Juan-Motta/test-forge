"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Input } from "@/ui";
import { PRICE_BUCKETS, type ModelPrice, type PriceBucket } from "./types";

export const BUCKET_LABELS: Record<PriceBucket, string> = {
  textIn: "text input",
  cachedTextIn: "cached text input",
  audioIn: "audio input",
  cachedAudioIn: "cached audio input",
  textOut: "text output",
  audioOut: "audio output",
};
const HEADERS: Record<PriceBucket, string> = {
  textIn: "Text in",
  cachedTextIn: "Cached text in",
  audioIn: "Audio in",
  cachedAudioIn: "Cached audio in",
  textOut: "Text out",
  audioOut: "Audio out",
};
const NEGATIVE = "Prices must be zero or more, as plain numbers with at most 4 decimals.";

type Draft = Record<string, Record<PriceBucket, string>>;

function draftOf(items: ModelPrice[]): Draft {
  return Object.fromEntries(
    items.map((item) => [
      item.model,
      Object.fromEntries(PRICE_BUCKETS.map((bucket) => [bucket, item[bucket] == null ? "" : String(item[bucket])])) as Record<
        PriceBucket,
        string
      >,
    ]),
  );
}

/** A plain decimal of zero or more with at most 4 decimals (the server stores 4). */
const PRICE_PATTERN = /^\d+(\.\d{1,4})?$/;

/** A cell's price: empty means no price; anything else must match PRICE_PATTERN. */
function parsePrice(value: string): number | null | "invalid" {
  const text = value.trim();
  if (text === "") return null;
  return PRICE_PATTERN.test(text) ? Number(text) : "invalid";
}

type ModelPricesFormProps = {
  items: ModelPrice[];
  saving: boolean;
  error?: string;
  onSave: (items: ModelPrice[]) => void;
};

/** The editable price table: USD per 1M tokens per model and usage bucket; empty is no price. */
export function ModelPricesForm({ items, saving, error, onSave }: ModelPricesFormProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(items));
  const [invalid, setInvalid] = useState<Set<string>>(new Set());

  function change(model: string, bucket: PriceBucket, value: string) {
    setDraft((current) => ({ ...current, [model]: { ...current[model], [bucket]: value } }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const bad = new Set<string>();
    const next = items.map((item) => {
      const prices: ModelPrice = { model: item.model };
      for (const bucket of PRICE_BUCKETS) {
        const parsed = parsePrice(draft[item.model][bucket]);
        if (parsed === "invalid") bad.add(`${item.model}:${bucket}`);
        prices[bucket] = parsed === "invalid" ? null : parsed;
      }
      return prices;
    });
    setInvalid(bad);
    if (bad.size === 0) onSave(next);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table aria-label="Model prices" className="w-full min-w-[52rem] border-collapse text-left text-[13px]">
          <thead className="text-dim">
            <tr>
              <th scope="col" className="border-b border-line px-2 py-2 font-medium">
                Model
              </th>
              {PRICE_BUCKETS.map((bucket) => (
                <th key={bucket} scope="col" className="border-b border-line px-2 py-2 font-medium">
                  {HEADERS[bucket]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.model} className="[&:last-child>td]:border-b-0 [&:last-child>th]:border-b-0">
                <th scope="row" className="border-b border-line-soft px-2 py-2 font-mono text-xs font-medium">
                  {item.model}
                </th>
                {PRICE_BUCKETS.map((bucket) => (
                  <td key={bucket} className="border-b border-line-soft px-2 py-2">
                    <Input
                      mono
                      type="text"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      placeholder="—"
                      aria-label={`${item.model} ${BUCKET_LABELS[bucket]}`}
                      aria-invalid={invalid.has(`${item.model}:${bucket}`) || undefined}
                      value={draft[item.model]?.[bucket] ?? ""}
                      onChange={(event) => change(item.model, bucket, event.target.value)}
                      className="min-w-[6.5rem]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invalid.size > 0 ? <Alert>{NEGATIVE}</Alert> : error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={saving}>
          Save prices
        </Button>
        <span className="text-xs text-dim">USD per 1M tokens. Leave a field empty when the model has no such price.</span>
      </div>
    </form>
  );
}
