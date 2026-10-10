"use client";

import { useRouter } from "next/navigation";
import { ScenarioEditorContainer } from "./ScenarioEditorContainer";

/**
 * `/scenarios/new`. Next preserves visited pages (Activity), so without a key a second visit
 * would show the previous draft; `bfcacheId` changes on every fresh (push/replace) visit and
 * stays the same on back/forward, which keeps a draft the user returns to.
 */
export function NewScenario() {
  const { bfcacheId } = useRouter();
  return <ScenarioEditorContainer key={bfcacheId} />;
}
