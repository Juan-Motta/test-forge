"use client";

import type { ReactNode } from "react";
import { useT } from "@/lib/i18n";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Button,
  CloseIcon,
  CopyIcon,
  IconButton,
  Input,
  PlusIcon,
  SegmentedControl,
  Select,
  Textarea,
  TrashIcon,
} from "@/ui";
import {
  CHECK_OPS,
  METHODS,
  newCheck,
  newPair,
  newSave,
  valueless,
  withBodyMode,
  type BodyMode,
  type CheckDraft,
  type CheckType,
  type InputDraft,
  type PairDraft,
  type StepDraft,
} from "./flow-draft";
import { SourceChip } from "./SourceChip";
import type { HttpMethod } from "./types";
import { valueSource } from "./value-source";

const CHECK_TYPES: CheckType[] = ["status", "path", "duration"];

/** What a field gets when its row has an error: the message names it. */
type Described = { "aria-describedby"?: string; "aria-invalid"?: true };

type RowListProps<T extends { key: string }> = {
  legend: string;
  rows: T[];
  onChange: (rows: T[]) => void;
  create: () => T;
  addLabel: string;
  /** Accessible names of a row and of its remove button, by its 1-based number. */
  rowLabel: (m: number) => string;
  removeLabel: (m: number) => string;
  /** Error of the whole list, and of each row by index. */
  listError?: string;
  rowError: (index: number) => string | undefined;
  render: (row: T, m: number, update: (change: Partial<T>) => void, described: Described) => ReactNode;
};

/** Rows of one kind inside a step (query, headers, saves, checks), each removable, with Add. */
function RowList<T extends { key: string }>(props: RowListProps<T>) {
  const { legend, rows, onChange, create, addLabel, rowLabel, removeLabel, listError, rowError, render } = props;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1.5 text-xs font-medium text-muted">{legend}</legend>
      {rows.map((row, index) => {
        const m = index + 1;
        const error = rowError(index);
        const errorId = `${row.key}-error`;
        const described: Described = error ? { "aria-describedby": errorId, "aria-invalid": true } : {};
        const update = (change: Partial<T>) => onChange(rows.map((item) => (item.key === row.key ? { ...item, ...change } : item)));
        return (
          <div key={row.key} role="group" aria-label={rowLabel(m)} className="flex flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
              {render(row, m, update, described)}
              <IconButton
                size="sm"
                label={removeLabel(m)}
                icon={<CloseIcon size={14} />}
                onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
              />
            </div>
            {error ? (
              <p id={errorId} className="text-xs text-danger-fg">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
      {listError ? <p className="text-xs text-danger-fg">{listError}</p> : null}
      <Button variant="ghost" className="w-fit" icon={<PlusIcon size={14} />} onClick={() => onChange([...rows, create()])}>
        {addLabel}
      </Button>
    </fieldset>
  );
}

type StepCardProps = {
  index: number;
  count: number;
  step: StepDraft;
  /** The flow's inputs, to tell the values AI writes from the plain ones. */
  inputs: InputDraft[];
  /** The names of the API's secrets, to tell a secret `{{var.name}}` from a plain one. */
  secrets: ReadonlySet<string>;
  /** The flow's errors by row (`steps.<n>…`). */
  errors: Record<string, string>;
  onChange: (step: StepDraft) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  /** Copies this step's cURL; undefined while the flow is not saved yet. */
  onCopyCurl?: () => void;
};

/** One request of the flow: method, path and title; query, headers and JSON body; what it saves and checks. */
export function StepCard({ index, count, step, inputs, secrets, errors, onChange, onMove, onRemove, onCopyCurl }: StepCardProps) {
  const t = useT();
  const n = index + 1;
  const at = (field: string) => errors[`steps.${index}.${field}`];
  const update = (change: Partial<StepDraft>) => onChange({ ...step, ...change });
  const sourceInputs = inputs.map((input) => ({ name: input.name.trim(), generate: input.generate.trim() || null }));
  const headerErrors = [at("method"), at("path"), at("title"), errors[`steps.${index}`]].filter(Boolean);
  const bodyError = at("body");
  // In GraphQL mode a body error belongs to the query while it is empty, else to the variables.
  const queryError = bodyError && step.bodyMode === "graphql" && !step.gqlQuery.trim();

  const pairs = (list: "query" | "headers") => (
    <RowList<PairDraft>
      legend={t(list === "query" ? "flows.query" : "flows.headers")}
      rows={step[list]}
      onChange={(rows) => update({ [list]: rows })}
      create={newPair}
      addLabel={t(list === "query" ? "flows.addQuery" : "flows.addHeader")}
      rowLabel={(m) => t(list === "query" ? "flows.queryRow" : "flows.headerRow", { n, m })}
      removeLabel={(m) => t(list === "query" ? "flows.removeQuery" : "flows.removeHeader", { n, m })}
      listError={at(list)}
      rowError={(j) => at(`${list}.${j}`)}
      render={(row, m, change, described) => (
        <>
          <Input
            mono
            className="sm:w-[34%]"
            aria-label={t(list === "query" ? "flows.queryName" : "flows.headerName", { n, m })}
            value={row.name}
            onChange={(event) => change({ name: event.target.value })}
          />
          <Input
            mono
            className="min-w-0 flex-1"
            aria-label={t(list === "query" ? "flows.queryValue" : "flows.headerValue", { n, m })}
            value={row.value}
            onChange={(event) => change({ value: event.target.value })}
            {...described}
          />
          <SourceChip source={valueSource(row.value, sourceInputs, secrets)} />
        </>
      )}
    />
  );

  return (
    <section aria-label={t("flows.step", { n })} className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-chip text-xs font-semibold">
            {n}
          </span>
          <div className="w-[7.5rem] shrink-0">
            <Select
              aria-label={t("flows.step.method", { n })}
              value={step.method}
              className="font-mono"
              onChange={(event) => update({ method: event.target.value as HttpMethod })}
            >
              {METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </Select>
          </div>
          <Input
            mono
            className="min-w-[10rem] flex-[2]"
            aria-label={t("flows.step.path", { n })}
            aria-invalid={at("path") ? true : undefined}
            value={step.path}
            onChange={(event) => update({ path: event.target.value })}
          />
          <Input
            className="min-w-[10rem] flex-[2]"
            aria-label={t("flows.step.title", { n })}
            placeholder={t("flows.step.titlePlaceholder")}
            value={step.title}
            onChange={(event) => update({ title: event.target.value })}
          />
          <div className="flex shrink-0 items-center">
            <IconButton size="sm" label={t("flows.moveUp", { n })} icon={<ArrowUpIcon size={14} />} disabled={index === 0} onClick={() => onMove(-1)} />
            <IconButton
              size="sm"
              label={t("flows.moveDown", { n })}
              icon={<ArrowDownIcon size={14} />}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            />
            <IconButton size="sm" label={t("flows.copyCurl", { n })} icon={<CopyIcon size={14} />} disabled={!onCopyCurl} onClick={onCopyCurl} />
            <IconButton size="sm" label={t("flows.removeStep", { n })} icon={<TrashIcon size={14} />} disabled={count === 1} onClick={onRemove} />
          </div>
        </div>
        {headerErrors.map((error) => (
          <p key={error} className="text-xs text-danger-fg">
            {error}
          </p>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {pairs("query")}
        {pairs("headers")}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted">{t("flows.body")}</span>
          <SegmentedControl<BodyMode>
            label={t("flows.bodyMode", { n })}
            options={[
              { value: "json", label: "JSON" },
              { value: "graphql", label: "GraphQL" },
            ]}
            value={step.bodyMode}
            onChange={(mode) => onChange(withBodyMode(step, mode))}
          />
        </div>
        {step.bodyMode === "graphql" ? (
          <>
            <Textarea
              mono
              rows={6}
              aria-label={t("flows.gqlQueryOf", { n })}
              aria-invalid={queryError ? true : undefined}
              aria-describedby={queryError ? `${step.key}-body-error` : undefined}
              placeholder={"query($id: ID!) {\n  user(id: $id) { id name }\n}"}
              value={step.gqlQuery}
              onChange={(event) => update({ gqlQuery: event.target.value })}
            />
            <Textarea
              mono
              rows={step.gqlVariables ? 4 : 2}
              aria-label={t("flows.gqlVariablesOf", { n })}
              placeholder={t("flows.gqlVariablesPlaceholder")}
              aria-invalid={bodyError && !queryError ? true : undefined}
              aria-describedby={bodyError && !queryError ? `${step.key}-body-error` : undefined}
              value={step.gqlVariables}
              onChange={(event) => update({ gqlVariables: event.target.value })}
            />
          </>
        ) : (
          <Textarea
            id={`${step.key}-body`}
            mono
            rows={step.body ? 5 : 2}
            aria-label={t("flows.bodyOf", { n })}
            placeholder={t("flows.bodyPlaceholder")}
            aria-invalid={bodyError ? true : undefined}
            aria-describedby={bodyError ? `${step.key}-body-error` : undefined}
            value={step.body}
            onChange={(event) => update({ body: event.target.value })}
          />
        )}
        {bodyError ? (
          <p id={`${step.key}-body-error`} className="text-xs text-danger-fg">
            {bodyError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RowList
          legend={t("flows.saves")}
          rows={step.saves}
          onChange={(saves) => update({ saves })}
          create={newSave}
          addLabel={t("flows.addSave")}
          rowLabel={(m) => t("flows.saveRow", { n, m })}
          removeLabel={(m) => t("flows.removeSave", { n, m })}
          listError={at("saves")}
          rowError={(j) => at(`saves.${j}`)}
          render={(row, m, change, described) => (
            <>
              <Input
                mono
                className="sm:w-[40%]"
                aria-label={t("flows.saveName", { n, m })}
                placeholder="token"
                value={row.name}
                onChange={(event) => change({ name: event.target.value })}
                {...described}
              />
              <Input
                mono
                className="min-w-0 flex-1"
                aria-label={t("flows.savePath", { n, m })}
                placeholder="body.access_token"
                value={row.path}
                onChange={(event) => change({ path: event.target.value })}
              />
            </>
          )}
        />
        <RowList<CheckDraft>
          legend={t("flows.checks")}
          rows={step.checks}
          onChange={(checks) => update({ checks })}
          create={() => newCheck()}
          addLabel={t("flows.addCheck")}
          rowLabel={(m) => t("flows.checkRow", { n, m })}
          removeLabel={(m) => t("flows.removeCheck", { n, m })}
          listError={at("checks")}
          rowError={(j) => at(`checks.${j}`)}
          render={(check, m, change, described) => (
            <>
              <div className="w-[9.5rem] shrink-0">
                <Select
                  aria-label={t("flows.checkType", { n, m })}
                  value={check.type}
                  onChange={(event) => change({ type: event.target.value as CheckType })}
                >
                  {CHECK_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`flows.check.${type}`)}
                    </option>
                  ))}
                </Select>
              </div>
              {check.type === "status" ? (
                <Input
                  mono
                  inputMode="numeric"
                  className="min-w-0 flex-1"
                  aria-label={t("flows.checkEquals", { n, m })}
                  value={check.equals}
                  onChange={(event) => change({ equals: event.target.value })}
                  {...described}
                />
              ) : null}
              {check.type === "duration" ? (
                <Input
                  mono
                  inputMode="numeric"
                  className="min-w-0 flex-1"
                  aria-label={t("flows.checkMaxMs", { n, m })}
                  value={check.maxMs}
                  onChange={(event) => change({ maxMs: event.target.value })}
                  {...described}
                />
              ) : null}
              {check.type === "path" ? (
                <>
                  <Input
                    mono
                    className="min-w-0 flex-1"
                    aria-label={t("flows.checkPath", { n, m })}
                    placeholder="body.items.length"
                    value={check.path}
                    onChange={(event) => change({ path: event.target.value })}
                    {...described}
                  />
                  <div className="w-[6.5rem] shrink-0">
                    <Select aria-label={t("flows.checkOp", { n, m })} value={check.op} onChange={(event) => change({ op: event.target.value })}>
                      {CHECK_OPS.map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {valueless(check.op) ? null : (
                    <Input
                      mono
                      className="w-[7rem] shrink-0"
                      aria-label={t("flows.checkValue", { n, m })}
                      value={check.value}
                      onChange={(event) => change({ value: event.target.value })}
                    />
                  )}
                </>
              ) : null}
            </>
          )}
        />
      </div>
    </section>
  );
}

/** The arrow between two steps, naming what the earlier one saves for the next ones. */
export function StepConnector({ step }: { step: StepDraft }) {
  const t = useT();
  const names = step.saves.map((save) => save.name.trim()).filter(Boolean);
  return (
    <div className="flex items-center gap-2 pl-5 text-xs text-dim">
      <ArrowDownIcon size={14} />
      {names.length > 0 ? (
        <span>
          {t("flows.passes")}{" "}
          {names.map((name) => (
            <code key={name} className="mr-1 rounded bg-success/15 px-1.5 py-0.5 font-mono text-success-fg">
              {`{{saved.${name}}}`}
            </code>
          ))}
        </span>
      ) : null}
    </div>
  );
}
