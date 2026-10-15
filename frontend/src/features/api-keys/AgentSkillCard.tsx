"use client";

import { type ReactNode, useId, useState } from "react";
import { useT } from "@/lib/i18n";
import { Alert, Button, Card, CardHeader, CheckIcon, CodeBlock, CopyIcon, Input } from "@/ui";

type AgentSkillCardProps = {
  /** This deployment's origin, for the URLs and the command. */
  origin: string;
  onDownload: () => void;
  downloading: boolean;
  downloadError?: string;
};

type Copied = { target: string } | { failed: true } | null;

/** Builds the ready-to-paste command that saves the (public) skill. */
export function skillCurlCommand(origin: string): string {
  return `curl ${origin}/api/skill -o SKILL.md`;
}

/** Where an agent gets the skill: both URLs, a curl command and a session download. */
export function AgentSkillCard({ origin, onDownload, downloading, downloadError }: AgentSkillCardProps) {
  const t = useT();
  const headingId = useId();
  const [copied, setCopied] = useState<Copied>(null);
  const markdownUrl = `${origin}/api/skill`;
  const zipUrl = `${origin}/api/skill.zip`;
  const command = skillCurlCommand(origin);

  async function copy(target: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied({ target });
    } catch {
      setCopied({ failed: true });
    }
  }

  const copyIcon = (target: string) =>
    copied && "target" in copied && copied.target === target ? <CheckIcon size={16} /> : <CopyIcon size={16} />;

  return (
    <Card aria-labelledby={headingId} className="mt-6">
      <CardHeader
        id={headingId}
        title={t("skill.title")}
        actions={
          <Button variant="secondary" onClick={onDownload} disabled={downloading}>
            {downloading ? t("skill.downloading") : t("skill.download")}
          </Button>
        }
      />
      <p className="text-sm text-muted">
        {t("skill.description")}
      </p>
      <SkillUrl
        label={t("skill.markdown")}
        value={markdownUrl}
        copyLabel={t("skill.copyMarkdown")}
        icon={copyIcon("markdown")}
        onCopy={() => void copy("markdown", markdownUrl)}
      />
      <SkillUrl
        label={t("skill.zip")}
        value={zipUrl}
        copyLabel={t("skill.copyZip")}
        icon={copyIcon("zip")}
        onCopy={() => void copy("zip", zipUrl)}
      />
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted">{t("skill.saveIt")}</p>
        <div className="flex items-start gap-2">
          <CodeBlock code={command} label={t("skill.command")} tone="command" className="min-w-0 flex-1 break-all" />
          <Button
            variant="secondary"
            aria-label={t("skill.copyCommand")}
            icon={copyIcon("command")}
            onClick={() => void copy("command", command)}
          >
            {t("ui.copy")}
          </Button>
        </div>
      </div>
      <p role="status" className="text-xs text-dim">
        {copied === null ? "" : "failed" in copied ? t("skill.copyFailed") : t("ui.copied")}
      </p>
      {downloadError ? <Alert title={t("skill.downloadFailed")}>{downloadError}</Alert> : null}
    </Card>
  );
}

type SkillUrlProps = {
  label: string;
  value: string;
  copyLabel: string;
  icon: ReactNode;
  onCopy: () => void;
};

function SkillUrl({ label, value, copyLabel, icon, onCopy }: SkillUrlProps) {
  const t = useT();
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <div className="flex gap-2">
        <Input id={id} mono readOnly value={value} className="min-w-0 flex-1" />
        <Button variant="secondary" aria-label={copyLabel} icon={icon} onClick={onCopy}>
          {t("ui.copy")}
        </Button>
      </div>
    </div>
  );
}
