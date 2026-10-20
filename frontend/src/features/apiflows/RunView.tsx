"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { useFormat, useT } from "@/lib/i18n";
import {
  Alert,
  Badge,
  Button,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  MinusIcon,
  PencilIcon,
  PlayIcon,
  Spinner,
  buttonClasses,
  cn,
  focusRing,
  type BadgeTone,
} from "@/ui";
import { MethodChip } from "./MethodChip";
import { checkRule, formatBytes, formatDuration, jsonTokens, pathOf, prettyBody, textOf, type JsonToken } from "./run-view";
import { SecretText } from "./SecretText";
import type { ApiHeader, FlowRun, StepRun, StepStatus } from "./types";

const STATUS_TONE: Record<StepStatus, BadgeTone> = { passed: "success", failed: "danger", skipped: "muted" };
const PANEL = "flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-panel p-4";
const PRE = "max-h-96 overflow-auto rounded-lg border border-line-soft bg-field p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-fg";

/** JSON colours: keys stand apart from the values they name. */
const TOKEN_CLASS: Record<Exclude<JsonToken["kind"], "plain">, string> = {
  key: "text-agent-fg",
  string: "text-success-fg",
  number: "text-evaluator-fg",
  literal: "text-llm-fg",
};

function StatusIcon({ status, size = 14 }: { status: StepStatus; size?: number }) {
  if (status === "passed") return <CheckIcon size={size} className="text-success-fg" />;
  if (status === "failed") return <CloseIcon size={size} className="text-danger-fg" />;
  return <MinusIcon size={size} className="text-dim" />;
}

/** Secrets as the run view shows them: masked hints, and the values while the eye is on. */
export type SecretView = { hints: Record<string, string>; shown: Record<string, string> };

type RunViewProps = {
  run: FlowRun;
  flowName: string;
  editHref: string;
  againHref: string;
  /** The path each flow step was written with, for steps that sent nothing. */
  stepPaths: string[];
  selected: number;
  onSelect: (index: number) => void;
  secrets: SecretView;
  /** The eye: undefined when the API has no secrets. */
  eye?: { revealed: boolean; pending: boolean; onToggle: () => void; error?: string };
  onCopyCurl: () => void;
  status?: string;
  alert?: string;
};

/** A stored run: its header, the steps strip, and the selected step's request, response and checks. */
export function RunView(props: RunViewProps) {
  const { run, selected, onSelect, secrets } = props;
  const t = useT();
  const format = useFormat();
  const step = run.steps[selected];
  const titleId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-labelledby={titleId} className={cn(PANEL, "p-5")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 id={titleId} className="text-lg font-semibold break-words">
              {t("flowRuns.title", { name: props.flowName })}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={STATUS_TONE[run.status]}>
                {t("flowRuns.statusWithTime", {
                  status: t(`flowRuns.status.${run.status}`),
                  duration: formatDuration(run.durationMs, format.number),
                })}
              </Badge>
              <time dateTime={run.createdAt} title={format.absoluteTime(run.createdAt)}>
                {format.relativeTime(run.createdAt)}
              </time>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={props.editHref} className={buttonClasses("ghost")}>
              <PencilIcon size={14} />
              {t("flowRuns.editFlow")}
            </Link>
            <Link href={props.againHref} className={buttonClasses("secondary")}>
              <PlayIcon size={14} />
              {t("flowRuns.again")}
            </Link>
          </div>
        </div>
        {run.inputs.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-muted">{t("flowRuns.inputs")}</h3>
            <ul aria-label={t("flowRuns.inputs")} className="flex flex-wrap gap-1.5">
              {run.inputs.map((input) => (
                <li
                  key={input.name}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-field-line bg-field py-0.5 pr-1 pl-2.5 font-mono text-xs"
                >
                  <span className="text-muted">{input.name}</span>
                  <span className="break-all text-fg">{textOf(input.value)}</span>
                  <Badge tone={input.source === "generated" ? "evaluator" : "muted"}>{t(`flowRuns.source.${input.source}`)}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <StepsStrip run={run} stepPaths={props.stepPaths} selected={selected} onSelect={onSelect} />

      {step ? (
        <section aria-label={t("flowRuns.stepDetails", { n: step.index + 1, title: step.title })} className="flex flex-col gap-4">
          <span role="status" className="text-xs text-success-fg empty:hidden">
            {props.status}
          </span>
          {props.alert ? <Alert>{props.alert}</Alert> : null}
          {step.error ? (
            <Alert title={t("flowRuns.error")}>
              <SecretText text={step.error} {...secrets} />
            </Alert>
          ) : null}
          <div className="grid gap-4 min-[1100px]:grid-cols-2">
            <RequestPanel step={step} secrets={secrets} eye={props.eye} onCopyCurl={props.onCopyCurl} />
            <ResponsePanel step={step} secrets={secrets} />
          </div>
          <ChecksPanel step={step} secrets={secrets} />
          {Object.keys(step.saved).length > 0 ? (
            <Panel title={t("flowRuns.saved")}>
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 font-mono text-xs">
                {Object.entries(step.saved).map(([name, value]) => (
                  <div key={name} className="contents">
                    <dt className="text-muted">{name}</dt>
                    <dd className="break-all text-fg">
                      <SecretText text={textOf(value)} {...secrets} />
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function StepsStrip({ run, stepPaths, selected, onSelect }: Pick<RunViewProps, "run" | "stepPaths" | "selected" | "onSelect">) {
  const t = useT();
  const format = useFormat();
  return (
    <ol aria-label={t("flowRuns.steps")} className="flex gap-2 overflow-x-auto pb-1">
      {run.steps.map((step, index) => {
        const path = step.request ? pathOf(step.request.url) : (stepPaths[index] ?? "");
        const facts = [step.response ? String(step.response.status) : null, step.durationMs === null ? null : formatDuration(step.durationMs, format.number)]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={step.index} className="min-w-[11rem] flex-1">
            <button
              type="button"
              aria-pressed={index === selected}
              aria-label={t("flowRuns.step", { n: step.index + 1, title: step.title, status: t(`flowRuns.status.${step.status}`) })}
              onClick={() => onSelect(index)}
              className={cn(
                "flex h-full w-full flex-col gap-1.5 rounded-xl border bg-panel px-3 py-2.5 text-left hover:bg-active",
                index === selected ? "border-evaluator" : "border-line",
                focusRing,
              )}
            >
              <span className="flex items-center gap-1.5">
                <StatusIcon status={step.status} />
                {step.request ? <MethodChip method={step.request.method} /> : null}
                <span className="truncate text-xs text-muted">{step.title}</span>
              </span>
              <span className="truncate font-mono text-xs text-fg">{path}</span>
              {facts ? <span className="font-mono text-[11px] text-dim">{facts}</span> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Panel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className={PANEL}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Headers({ headers, secrets }: { headers: ApiHeader[]; secrets: SecretView }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-xs">
      {headers.map((header, index) => (
        <div key={`${header.name}-${index}`} className="contents">
          <dt className="text-muted">{header.name}</dt>
          <dd className="break-all text-fg">
            <SecretText text={header.value} {...secrets} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Body({ body, secrets, label }: { body: unknown; secrets: SecretView; label: string }) {
  const t = useT();
  const pretty = prettyBody(body);
  if (!pretty) return <p className="text-xs text-dim">{t("flowRuns.noBody")}</p>;
  if (pretty.kind === "text") {
    return (
      <pre aria-label={label} data-kind={pretty.kind} className={PRE}>
        <SecretText text={pretty.text} {...secrets} />
      </pre>
    );
  }
  return (
    <pre aria-label={label} data-kind={pretty.kind} className={PRE}>
      {jsonTokens(pretty.text).map((token, index) =>
        token.kind === "plain" ? (
          token.text
        ) : (
          <span key={index} data-token={token.kind} className={TOKEN_CLASS[token.kind]}>
            {token.kind === "key" || token.kind === "string" ? <SecretText text={token.text} {...secrets} /> : token.text}
          </span>
        ),
      )}
    </pre>
  );
}

type RequestPanelProps = { step: StepRun; secrets: SecretView; eye: RunViewProps["eye"]; onCopyCurl: () => void };

function RequestPanel({ step, secrets, eye, onCopyCurl }: RequestPanelProps) {
  const t = useT();
  const request = step.request;
  const actions = request ? (
    <>
      {eye ? (
        <Button
          variant="ghost"
          aria-pressed={eye.revealed}
          aria-busy={eye.pending || undefined}
          icon={eye.pending ? <Spinner size={13} /> : eye.revealed ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
          onClick={eye.pending ? undefined : eye.onToggle}
        >
          {t(eye.revealed ? "flowRuns.hideSecrets" : "flowRuns.showSecrets")}
        </Button>
      ) : null}
      <Button variant="secondary" icon={<CopyIcon size={14} />} onClick={onCopyCurl}>
        {t("flowRuns.copyCurl")}
      </Button>
    </>
  ) : undefined;
  return (
    <Panel title={t("flowRuns.request")} actions={actions}>
      {eye?.error ? (
        <p role="alert" className="text-xs text-danger-fg">
          {t("apis.revealFailed", { error: eye.error })}
        </p>
      ) : null}
      {request ? (
        <>
          <p className="flex min-w-0 items-start gap-2">
            <MethodChip method={request.method} />
            <span className="font-mono text-xs break-all text-fg">
              <SecretText text={request.url} {...secrets} />
            </span>
          </p>
          {request.headers.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <h4 className="text-xs font-medium text-muted">{t("flowRuns.headers")}</h4>
              <Headers headers={request.headers} secrets={secrets} />
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <h4 className="text-xs font-medium text-muted">{t("flowRuns.body")}</h4>
            <Body body={request.body} secrets={secrets} label={t("flowRuns.request")} />
          </div>
        </>
      ) : (
        <p className="text-xs text-dim">{t("flowRuns.notSent")}</p>
      )}
    </Panel>
  );
}

function ResponsePanel({ step, secrets }: { step: StepRun; secrets: SecretView }) {
  const t = useT();
  const format = useFormat();
  const response = step.response;
  return (
    <Panel title={t("flowRuns.response")}>
      {response ? (
        <>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <div className="flex gap-1.5">
              <dt className="text-muted">{t("flowRuns.statusCode")}</dt>
              <dd className={cn("font-mono font-semibold", response.status < 400 ? "text-success-fg" : "text-danger-fg")}>
                {response.status}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted">{t("flowRuns.size")}</dt>
              <dd className="font-mono text-fg">{formatBytes(response.sizeBytes, format.number)}</dd>
            </div>
          </dl>
          <Body body={response.body} secrets={secrets} label={t("flowRuns.response")} />
          {response.headers.length > 0 ? (
            <details className="text-xs">
              <summary className={cn("cursor-pointer rounded text-muted hover:text-fg", focusRing)}>
                {t("flowRuns.responseHeaders", { count: response.headers.length })}
              </summary>
              <div className="mt-2">
                <Headers headers={response.headers} secrets={secrets} />
              </div>
            </details>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-dim">{t("flowRuns.noResponse")}</p>
      )}
    </Panel>
  );
}

function ChecksPanel({ step, secrets }: { step: StepRun; secrets: SecretView }) {
  const t = useT();
  return (
    <Panel title={t("flowRuns.checks")}>
      {step.checks.length === 0 ? (
        <p className="text-xs text-dim">{t("flowRuns.noChecks")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {step.checks.map((result, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <StatusIcon status={result.passed ? "passed" : "failed"} />
              <span className="text-fg">{checkRule(result.check)}</span>
              <Badge tone={result.passed ? "success" : "danger"}>{t(result.passed ? "flowRuns.status.passed" : "flowRuns.status.failed")}</Badge>
              <span className="break-all text-muted">
                {t("flowRuns.actual")}{" "}
                <SecretText text={textOf(result.actual)} {...secrets} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
