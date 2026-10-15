"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runsQueryKey } from "@/features/runs/queries";
import { getPricing, savePricing } from "./api";
import type { Pricing } from "./types";

export const pricingQueryKey = ["pricing"] as const;

export function usePricing() {
  return useQuery({ queryKey: pricingQueryKey, queryFn: ({ signal }) => getPricing(signal) });
}

/** Saves the table; run costs are computed from it, so the runs are refetched too. */
export function useSavePricing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: savePricing,
    onSuccess: (pricing) => {
      queryClient.setQueryData<Pricing>(pricingQueryKey, pricing);
      return queryClient.invalidateQueries({ queryKey: runsQueryKey });
    },
  });
}
