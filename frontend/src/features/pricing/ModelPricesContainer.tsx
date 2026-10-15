"use client";

import { useState } from "react";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, Button, Card, CardHeader, Spinner } from "@/ui";
import { ModelPricesForm } from "./ModelPricesForm";
import { usePricing, useSavePricing } from "./queries";
import type { ModelPrice } from "./types";

/** Container for `/settings/pricing`: the price table the evaluation costs are computed with. */
export function ModelPricesContainer() {
  const t = useT();
  const pricing = usePricing();
  const save = useSavePricing();
  const [notice, setNotice] = useState("");

  async function submit(items: ModelPrice[]) {
    setNotice("");
    try {
      await save.mutateAsync(items);
      setNotice(t("prices.saved"));
    } catch {
      // shown from the mutation's error
    }
  }

  let body;
  if (pricing.isPending) {
    body = <Spinner label={t("prices.loading")} />;
  } else if (pricing.isError) {
    body = (
      <Alert title={t("prices.loadFailed")}>
        <span className="block">{errorMessage(pricing.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => pricing.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else {
    const data = pricing.data;
    body = (
      <Card aria-labelledby="model-prices">
        <CardHeader id="model-prices" title={t("prices.title")} />
        <div className="flex flex-col gap-1 text-sm text-muted">
          <p>{data.note}</p>
          <p>
            {`${t("prices.seededFrom")} `}
            <a href={data.source} target="_blank" rel="noopener noreferrer" className="text-fg underline">
              {t("prices.openaiPricing")}
              <span className="sr-only">{` ${t("common.newTab")}`}</span>
            </a>{" "}
            {t("prices.asOf", { date: data.asOf })}
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
        eyebrow={t("nav.settings")}
        title={t("prices.title")}
        description={t("prices.description")}
      />
      <p role="status" className="text-sm text-success-fg empty:hidden">
        {notice}
      </p>
      {body}
    </>
  );
}
