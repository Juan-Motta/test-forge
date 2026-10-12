"use client";

import { type ReactNode, useId, useState } from "react";
import { Alert, Button, Card, CardHeader, CheckIcon, CopyIcon, Input } from "@/ui";

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
        title="Agent skill"
        actions={
          <Button variant="secondary" onClick={onDownload} disabled={downloading}>
            {downloading ? "Downloading…" : "Download skill (.zip)"}
          </Button>
        }
      />
      <p className="text-sm text-muted">
        Give an AI agent this skill so it knows every endpoint, the flows and how to read results. Using the API itself needs an API key.
      </p>
      <SkillUrl
        label="SKILL.md (Markdown)"
        value={markdownUrl}
        copyLabel="Copy SKILL.md URL"
        icon={copyIcon("markdown")}
        onCopy={() => void copy("markdown", markdownUrl)}
      />
      <SkillUrl
        label="Skill folder (.zip)"
        value={zipUrl}
        copyLabel="Copy zip URL"
        icon={copyIcon("zip")}
        onCopy={() => void copy("zip", zipUrl)}
      />
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted">Save it</p>
        <div className="flex items-start gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-line bg-raised px-3 py-2.5 font-mono text-xs whitespace-pre-wrap break-all">
            <code>{command}</code>
          </pre>
          <Button
            variant="secondary"
            aria-label="Copy command"
            icon={copyIcon("command")}
            onClick={() => void copy("command", command)}
          >
            Copy
          </Button>
        </div>
      </div>
      <p role="status" className="text-xs text-dim">
        {copied === null ? "" : "failed" in copied ? "Could not copy. Select the text and copy it." : "Copied"}
      </p>
      {downloadError ? <Alert title="Could not download the skill">{downloadError}</Alert> : null}
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
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <div className="flex gap-2">
        <Input id={id} mono readOnly value={value} className="min-w-0 flex-1" />
        <Button variant="secondary" aria-label={copyLabel} icon={icon} onClick={onCopy}>
          Copy
        </Button>
      </div>
    </div>
  );
}
