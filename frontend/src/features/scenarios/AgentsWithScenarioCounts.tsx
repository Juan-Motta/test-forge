"use client";

import { useMemo } from "react";
import { AgentsContainer } from "@/features/agents/AgentsContainer";
import { countByAgent } from "./library";
import { useScenarios } from "./queries";

/** `/agents` with each agent's scenario count (left out while the scenarios are unknown). */
export function AgentsWithScenarioCounts() {
  const scenarios = useScenarios();
  const counts = useMemo(() => (scenarios.data ? countByAgent(scenarios.data) : undefined), [scenarios.data]);
  return <AgentsContainer scenarioCounts={counts} />;
}
