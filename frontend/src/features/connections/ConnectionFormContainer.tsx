"use client";

import { useRef } from "react";
import { formErrorView } from "./errors";
import { ConnectionForm, type TestOutcome, type TestTarget } from "./ConnectionForm";
import { toChanges, toDraft, toNewConnection, type ConnectionFormValues } from "./form-schema";
import {
  useCreateConnection,
  useTestDraftConnection,
  useTestStoredConnection,
  useUpdateConnection,
} from "./queries";
import type { Connection } from "./types";

type ConnectionFormContainerProps = {
  /** Present when editing. */
  connection?: Connection;
  onCancel: () => void;
  onSaved: (connection: Connection) => void;
};

/**
 * Container: saves (create or PATCH with only what changed) and tests (draft or stored).
 * Mounted only while its dialog is open, so every opening starts with clean mutation state.
 */
export function ConnectionFormContainer({ connection, onCancel, onSaved }: ConnectionFormContainerProps) {
  const create = useCreateConnection();
  const update = useUpdateConnection();
  const testDraft = useTestDraftConnection();
  const testStored = useTestStoredConnection();
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const saving = useRef(false);

  const save = connection ? update : create;

  function resetAll() {
    create.reset();
    update.reset();
    testDraft.reset();
    testStored.reset();
  }

  function onSubmit(values: ConnectionFormValues) {
    if (saving.current) return;
    resetAll();
    if (connection) {
      const changes = toChanges(connection, values);
      if (Object.keys(changes).length === 0) {
        onSaved(connection);
        return;
      }
      saving.current = true;
      update.mutate(
        { id: connection.id, changes },
        { onSuccess: onSaved, onSettled: () => (saving.current = false) },
      );
    } else {
      saving.current = true;
      create.mutate(toNewConnection(values), { onSuccess: onSaved, onSettled: () => (saving.current = false) });
    }
  }

  function onTest(values: ConnectionFormValues, target: TestTarget) {
    resetAll();
    if (target === "stored" && connection) testStored.mutate(connection);
    else testDraft.mutate(toDraft(values));
  }

  const testOutcome: TestOutcome | undefined = testStored.data
    ? { result: testStored.data, target: "stored" }
    : testDraft.data
      ? { result: testDraft.data, target: "draft" }
      : undefined;
  // Every save or test resets the others first, so at most one of these holds an error.
  const failure = save.error ?? testDraft.error ?? testStored.error;
  const view = failure ? formErrorView(failure) : undefined;

  return (
    <ConnectionForm
      connection={connection}
      onSubmit={onSubmit}
      onCancel={onCancel}
      onTest={onTest}
      pending={save.isPending}
      testing={testDraft.isPending || testStored.isPending}
      testOutcome={testOutcome}
      error={view?.message}
      serverFieldErrors={view?.fieldErrors}
    />
  );
}
