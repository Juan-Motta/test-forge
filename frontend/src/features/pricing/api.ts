import { apiFetch } from "@/lib/api";
import type { ModelPrice, Pricing } from "./types";

const BASE = "/pricing";

export function getPricing(signal?: AbortSignal): Promise<Pricing> {
  return apiFetch<Pricing>(BASE, { signal });
}

/** Replaces the whole table: a model left out is removed. */
export function savePricing(items: ModelPrice[]): Promise<Pricing> {
  return apiFetch<Pricing>(BASE, { method: "PUT", body: { items } });
}
