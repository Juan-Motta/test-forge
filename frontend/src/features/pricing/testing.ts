import { http, HttpResponse } from "msw/http";
import { apiUrl, server } from "@/test/server";
import type { ModelPrice, Pricing, RunCost } from "./types";

export const SEEDED_PRICES: ModelPrice[] = [
  { model: "gpt-4o-mini-tts", textIn: 0.6, cachedTextIn: null, audioIn: null, cachedAudioIn: null, textOut: null, audioOut: 12 },
  { model: "gpt-6-luna", textIn: 0.1, cachedTextIn: 0.01, audioIn: null, cachedAudioIn: null, textOut: 0.5, audioOut: null },
  { model: "gpt-realtime-2.1", textIn: 4, cachedTextIn: 0.4, audioIn: 32, cachedAudioIn: 0.4, textOut: 24, audioOut: 64 },
  { model: "gpt-realtime-2.1-mini", textIn: 0.6, cachedTextIn: 0.06, audioIn: 10, cachedAudioIn: 0.3, textOut: 2.4, audioOut: 20 },
];

export function pricingFixture(overrides: Partial<Pricing> = {}): Pricing {
  return {
    currency: "USD",
    unit: "per 1M tokens",
    source: "https://developers.openai.com/api/docs/pricing",
    asOf: "2026-10-15",
    note: "Approximate: OpenAI list prices (standard tier, USD per 1M tokens). Azure OpenAI prices are not published for these models and may differ.",
    updatedAt: "2026-10-15T10:00:00Z",
    items: SEEDED_PRICES,
    ...overrides,
  };
}

export function runCostFixture(overrides: Partial<RunCost> = {}): RunCost {
  return {
    callerUsd: 0.4123,
    judgeUsd: 0.0312,
    totalUsd: 0.4435,
    complete: true,
    notes: [],
    breakdown: [
      { part: "caller", model: "gpt-realtime-2.1-mini", usd: 0.4123 },
      { part: "judge", model: "gpt-6-luna", usd: 0.0312 },
    ],
    ...overrides,
  };
}

/** In-memory `/api/pricing`: keeps the table across calls and records every `PUT` body. */
export function mockPricingApi(initial: Pricing = pricingFixture()) {
  const state = { pricing: initial, saved: [] as unknown[] };
  server.use(
    http.get(apiUrl("/pricing"), () => HttpResponse.json(state.pricing)),
    http.put(apiUrl("/pricing"), async ({ request }) => {
      const body = (await request.json()) as { items: ModelPrice[] };
      state.saved.push(body);
      state.pricing = { ...state.pricing, items: body.items, updatedAt: "2026-10-16T09:00:00Z" };
      return HttpResponse.json(state.pricing);
    }),
  );
  return state;
}
