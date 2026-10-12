import { Button, CheckIcon, CodeBlock, CopyIcon } from "@/ui";

type HandoffCardProps = {
  brief: string;
  onCopy: () => void;
  copied: boolean;
  onDownload: () => void;
};

/** The judge's Markdown brief for a coding agent, to copy or download. */
export function HandoffCard({ brief, onCopy, copied, onDownload }: HandoffCardProps) {
  return (
    <section
      aria-labelledby="handoff-title"
      className="flex flex-col gap-4 rounded-xl border border-evaluator-line bg-panel p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="handoff-title" className="text-lg font-semibold">
          Handoff to your coding agent
        </h2>
        <p className="text-[13px] text-muted">A self-contained brief: context, evidence, and the changes to make.</p>
      </div>
      <CodeBlock code={brief} label="Brief for a coding agent" maxHeightClassName="max-h-[300px]" />
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="secondary" onClick={onDownload}>
          Download .md
        </Button>
        <Button icon={copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />} onClick={onCopy}>
          Copy brief
        </Button>
      </div>
    </section>
  );
}
