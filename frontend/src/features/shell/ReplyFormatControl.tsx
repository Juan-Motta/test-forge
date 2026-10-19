"use client";

import { useReplyFormat, type ReplyFormat } from "@/lib/browser/reply-format";
import { useT } from "@/lib/i18n";
import { SegmentedControl } from "@/ui";

const CHOICES: readonly ReplyFormat[] = ["markdown", "raw"];

/** Formatted / Raw switch for text agents' replies, remembered in this browser. */
export function ReplyFormatControl({ className }: { className?: string }) {
  const t = useT();
  const [format, setFormat] = useReplyFormat();
  const options = CHOICES.map((value) => ({ value, label: t(`replyFormat.${value}`) }));
  return <SegmentedControl label={t("replyFormat.label")} options={options} value={format} onChange={setFormat} className={className} />;
}
