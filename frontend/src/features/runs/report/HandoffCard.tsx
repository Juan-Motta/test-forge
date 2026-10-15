import { useT } from "@/lib/i18n";
import { Button, CheckIcon, CodeBlock, CopyIcon } from "@/ui";

type HandoffCardProps = {
  brief: string;
  onCopy: () => void;
  copied: boolean;
  onDownload: () => void;
};

/** The judge's Markdown brief for a coding agent, to copy or download. */
export function HandoffCard({ brief, onCopy, copied, onDownload }: HandoffCardProps) {
  const t = useT();
  return (
    <section
      aria-labelledby="handoff-title"
      className="flex flex-col gap-4 rounded-xl border border-evaluator-line bg-panel p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="handoff-title" className="text-lg font-semibold">
          {t("report.handoffTitle")}
        </h2>
        <p className="text-[13px] text-muted">{t("report.handoffHint")}</p>
      </div>
      <CodeBlock code={brief} label={t("report.briefLabel")} maxHeightClassName="max-h-[300px]" />
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="secondary" onClick={onDownload}>
          {t("report.downloadMd")}
        </Button>
        <Button icon={copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />} onClick={onCopy}>
          {t("report.copyBrief")}
        </Button>
      </div>
    </section>
  );
}
