"use client";

import { useT } from "@/lib/i18n";
import { Button, Dialog, Textarea, useClipboard } from "@/ui";

type ExportDialogProps = {
  open: boolean;
  title: string;
  /** The config as text (see `toTransferText`). */
  text: string;
  fileName: string;
  onClose: () => void;
};

/** Shows an exported config to read, copy or download as a `.json` file. */
export function ExportDialog({ open, title, text, fileName, onClose }: ExportDialogProps) {
  const t = useT();
  const [copyState, copy] = useClipboard();

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog
      open={open}
      size="lg"
      title={title}
      description={t("transfer.exportDescription")}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("transfer.close")}
          </Button>
          <Button variant="secondary" onClick={download}>
            {t("transfer.download")}
          </Button>
          <Button onClick={() => void copy(text)}>
            {copyState === "copied" ? t("transfer.copied") : t("transfer.copy")}
          </Button>
        </>
      }
    >
      <Textarea
        mono
        readOnly
        rows={14}
        aria-label={t("transfer.exportText")}
        value={text}
        onFocus={(event) => event.currentTarget.select()}
      />
      <p role="status" className="sr-only">
        {copyState === "copied" ? t("transfer.copied") : copyState === "failed" ? t("transfer.copyFailed") : ""}
      </p>
    </Dialog>
  );
}
