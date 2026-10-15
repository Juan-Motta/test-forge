"use client";

import { useState } from "react";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { Alert, Button, Card, CardHeader, Spinner } from "@/ui";
import { ModelPricesForm } from "./ModelPricesForm";
import { usePricing, useSavePricing } from "./queries";
import type { ModelPrice } from "./types";

/** Container for `/settings/pricing`: the price table the evaluation costs are computed with. */
export function ModelPricesContainer() {
  const pricing = usePricing();
  const save = useSavePricing();
  const [notice, setNotice] = useState("");

  async function submit(items: ModelPrice[]) {
    setNotice("");
    try {
      await save.mutateAsync(items);
      setNotice("Prices saved.");
    } catch {
      // shown from the mutation's error
    }
  }

  let body;
  if (pricing.isPending) {
    body = <Spinner label="Loading prices" />;
  } else if (pricing.isError) {
    body = (
      <Alert title="Could not load the prices">
        <span className="block">{errorMessage(pricing.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => pricing.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  } else {
    const data = pricing.data;
    body = (
      <Card aria-labelledby="model-prices">
        <CardHeader id="model-prices" title="Model prices" />
        <div className="flex flex-col gap-1 text-sm text-muted">
          <p>{data.note}</p>
          <p>
            Seeded from{" "}
            <a href={data.source} target="_blank" rel="noopener noreferrer" className="text-fg underline">
              OpenAI pricing<span className="sr-only"> (opens in a new tab)</span>
            </a>{" "}
            as of {data.asOf}. A run&apos;s cost counts the evaluator&apos;s models and the judge, never the agent.
          </p>
        </div>
        <ModelPricesForm
          key={data.updatedAt ?? "seeded"}
          items={data.items}
          saving={save.isPending}
          error={save.isError ? errorMessage(save.error) : undefined}
          onSave={(items) => void submit(items)}
        />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Model prices"
        description="Per-model token prices used to estimate what each evaluation costs."
      />
      <p role="status" className="text-sm text-success-fg empty:hidden">
        {notice}
      </p>
      {body}
    </>
  );
}
