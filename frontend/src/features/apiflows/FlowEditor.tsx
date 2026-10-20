"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { EditableTitle } from "@/features/scenarios/EditableTitle";
import { useT } from "@/lib/i18n";
import { Alert, Button, PlayIcon, PlusIcon, Textarea, TrashIcon, buttonClasses } from "@/ui";
import { AgentPicker } from "./AgentPicker";
import { moved, newStep, type FlowDraft, type StepDraft } from "./flow-draft";
import { InputsCard } from "./InputsCard";
import { SourceLegend } from "./SourceChip";
import { StepCard, StepConnector } from "./StepCard";
import type { NamedRef } from "./types";

export type FlowEditorProps = {
  draft: FlowDraft;
  onChange: (draft: FlowDraft) => void;
  /** Errors by editor row (see `flow-errors.ts`), plus the ones no row shows. */
  errors: Record<string, string>;
  formErrors: string[];
  alert?: string;
  status?: string;
  saving: boolean;
  onSave: () => void;
  /** Where "Run flow" goes; undefined for a new flow. */
  runHref?: string;
  onDelete?: () => void;
  /** Copies step N's cURL; undefined for a new flow. */
  onCopyCurl?: (index: number) => void;
  agents: NamedRef[] | undefined;
  agentsFailed: boolean;
  knownAgents: NamedRef[];
  /** The flow's recent runs, under its header; undefined for a new flow. */
  recentRuns?: ReactNode;
};

/** The flow editor: header, value-source legend, inputs, and the steps joined by arrows. */
export function FlowEditor(props: FlowEditorProps) {
  const { draft, onChange, errors, formErrors, alert, status, saving, onSave, runHref, onDelete, onCopyCurl } = props;
  const t = useT();
  const set = (change: Partial<FlowDraft>) => onChange({ ...draft, ...change });
  const setStep = (index: number, step: StepDraft) => set({ steps: draft.steps.map((item, i) => (i === index ? step : item)) });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-label={t("flows.editor")} className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-lg font-semibold">
              <EditableTitle
                size="section"
                value={draft.name}
                placeholder={t("flows.untitled")}
                label={t("flows.rename")}
                onCommit={(name) => {
                  set({ name });
                  return undefined;
                }}
              />
            </h2>
            {errors.name ? <p className="text-xs text-danger-fg">{errors.name}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onDelete ? (
              <Button variant="ghost" icon={<TrashIcon size={14} />} onClick={onDelete}>
                {t("flows.delete")}
              </Button>
            ) : null}
            {runHref ? (
              <Link href={runHref} className={buttonClasses("secondary")}>
                <PlayIcon size={14} />
                {t("flows.run")}
              </Link>
            ) : null}
            <Button loading={saving} onClick={onSave}>
              {t("flows.save")}
            </Button>
          </div>
        </div>
        <Textarea
          rows={2}
          aria-label={t("flows.description")}
          placeholder={t("flows.descriptionPlaceholder")}
          value={draft.description}
          onChange={(event) => set({ description: event.target.value })}
        />
        {errors.description ? <p className="text-xs text-danger-fg">{errors.description}</p> : null}
        <AgentPicker
          agents={props.agents}
          failed={props.agentsFailed}
          known={props.knownAgents}
          selected={draft.agentIds}
          onChange={(agentIds) => set({ agentIds })}
        />
        <span role="status" className="text-xs text-success-fg">
          {status}
        </span>
        {alert || formErrors.length > 0 ? (
          <Alert>
            {alert ? <span className="block">{alert}</span> : null}
            {formErrors.length > 0 ? (
              <ul className="list-disc pl-4">
                {formErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
        {props.recentRuns ? <div className="border-t border-line-soft pt-3">{props.recentRuns}</div> : null}
      </section>

      <SourceLegend />
      <InputsCard inputs={draft.inputs} onChange={(inputs) => set({ inputs })} errors={errors} />

      <section aria-label={t("flows.steps")} className="flex flex-col gap-2">
        {draft.steps.map((step, index) => (
          <Fragment key={step.key}>
            {index > 0 ? <StepConnector step={draft.steps[index - 1]} /> : null}
            <StepCard
              index={index}
              count={draft.steps.length}
              step={step}
              inputs={draft.inputs}
              errors={errors}
              onChange={(next) => setStep(index, next)}
              onMove={(delta) => set({ steps: moved(draft.steps, index, delta) })}
              onRemove={() => set({ steps: draft.steps.filter((item) => item.key !== step.key) })}
              onCopyCurl={onCopyCurl ? () => onCopyCurl(index) : undefined}
            />
          </Fragment>
        ))}
        <Button variant="secondary" className="mt-2 w-fit" icon={<PlusIcon size={14} />} onClick={() => set({ steps: [...draft.steps, newStep()] })}>
          {t("flows.addStep")}
        </Button>
      </section>
    </div>
  );
}
