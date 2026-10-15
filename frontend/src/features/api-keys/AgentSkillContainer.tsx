"use client";

import { useState } from "react";
import { localErrorMessage, useT } from "@/lib/i18n";
import { useOrigin } from "@/lib/browser/use-origin";
import { AgentSkillCard } from "./AgentSkillCard";
import { fetchSkillZip } from "./api";

export const SKILL_ZIP_FILE_NAME = "voice-evaluator-skill.zip";
/** Revoking in the same tick as the click can abort the download. */
export const REVOKE_SKILL_URL_MS = 1000;

/** Container for the agent skill card: downloads the zip with the session and saves it. */
export function AgentSkillContainer() {
  const t = useT();
  const origin = useOrigin();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function download() {
    if (downloading) return;
    setDownloading(true);
    setError(undefined);
    try {
      const blob = await fetchSkillZip();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = SKILL_ZIP_FILE_NAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_SKILL_URL_MS);
    } catch (cause) {
      setError(localErrorMessage(t, cause));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AgentSkillCard
      origin={origin}
      onDownload={() => void download()}
      downloading={downloading}
      downloadError={error}
    />
  );
}
