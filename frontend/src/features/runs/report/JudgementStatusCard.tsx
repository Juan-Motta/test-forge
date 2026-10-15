import { useState } from "react";
import { elapsed, isJudging } from "@/features/judgements/format";
import type { JudgementController } from "@/features/judgements/use-judgement-controller";
import { useT } from "@/lib/i18n";
import { Alert, Button, Card, CardHeader, Dialog, Spinner } from "@/ui";

const PROGRESS = { pending: "judgement.queued", judging: "judgement.judging" } as const;

/** The Judge run / Re-judge button; disabled while a judgement is in progress. */
export function JudgeButton({ controller }: { controller: JudgementController }) {
  const t = useT();
  const status = controller.judgement?.status;
  if (status === undefined) return null;
  return (
    <Button
      variant="secondary"
      className="min-h-9 px-3"
      loading={controller.judgeStarting}
      disabled={isJudging(status)}
      onClick={controller.judge}
    >
      {status === "none" ? t("judgement.judgeRun") : t("judgement.rejudge")}
    </Button>
  );
}

/** The judgement while it is not completed: not judged, queued, waiting for traces, judging or failed. */
export function JudgementStatusCard({ controller }: { controller: JudgementController }) {
  const t = useT();
  return (
    <Card aria-labelledby="judgement-status">
      <CardHeader id="judgement-status" title={t("judgement.title")} actions={<JudgeButton controller={controller} />} />
      {controller.judgeError ? <Alert>{t("judgement.couldNotJudge", { error: controller.judgeError })}</Alert> : null}
      <Body controller={controller} />
    </Card>
  );
}

function Body({ controller }: { controller: JudgementController }) {
  const t = useT();
  const { judgement, loadError, reload, judge, judgeStarting, now } = controller;
  if (loadError) {
    return (
      <Alert title={t("judgement.loadFailed")}>
        <span className="block">{loadError}</span>
        <Button variant="secondary" className="mt-3" onClick={reload}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  }
  if (!judgement) return <Spinner label={t("judgement.loading")} />;

  switch (judgement.status) {
    case "none":
      return <p className="text-sm text-muted">{t("judgement.notJudged")}</p>;
    case "pending":
    case "judging":
      return (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> {t(PROGRESS[judgement.status])}
        </p>
      );
    case "collecting_traces": {
      const since = Date.parse(judgement.updatedAt);
      return (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Spinner /> {t("judgement.waitingTraces")}
          {now > 0 && !Number.isNaN(since) ? (
            <span className="font-mono">{t("judgement.waitingFor", { elapsed: elapsed(now - since) })}</span>
          ) : null}
        </p>
      );
    }
    case "failed":
      return (
        <Alert title={t("judgement.failed")}>
          <span className="block">{judgement.error ?? t("judgement.unknownError")}</span>
          <Button variant="secondary" className="mt-3" loading={judgeStarting} onClick={judge}>
            {t("common.retry")}
          </Button>
        </Alert>
      );
    case "completed":
      return <p className="text-sm text-muted">{t("judgement.noResult")}</p>;
  }
}

/**
 * Above a completed judgement on a non-English page: says it is still in English (offering the
 * small paid translation, with why the last one failed) or that its translation is being written.
 */
export function TranslationNotice({ controller }: { controller: JudgementController }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const { translation, translationError, translateStarting, translateRequestError } = controller;
  if (translation === "translating") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> {t("judgement.translating")}
      </p>
    );
  }
  if (translation !== "english") return null;
  return (
    <Alert tone="info" title={t("judgement.inEnglish")}>
      {translationError ? <span className="block">{t("judgement.translationFailed", { error: translationError })}</span> : null}
      {translateRequestError ? (
        <span className="block">{t("judgement.translationRefused", { error: translateRequestError })}</span>
      ) : null}
      <Button variant="secondary" className="mt-3" loading={translateStarting} onClick={() => setConfirming(true)}>
        {t("judgement.translate")}
      </Button>
      <Dialog
        open={confirming}
        title={t("judgement.translateTitle")}
        description={t("judgement.translateDescription")}
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                controller.translate();
              }}
            >
              {t("judgement.translateConfirm")}
            </Button>
          </>
        }
      />
    </Alert>
  );
}
