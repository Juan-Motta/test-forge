"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage, formErrorView } from "@/lib/api";
import { useNow } from "@/lib/time/use-now";
import { Alert, Button, Dialog, EmptyState, PlusIcon, Spinner } from "@/ui";
import { ApiKeysTable } from "./ApiKeysTable";
import { CreateApiKeyForm } from "./CreateApiKeyForm";
import { CreatedApiKeyView } from "./CreatedApiKeyView";
import { KeyIcon } from "./KeyIcon";
import { useApiKeys, useCreateApiKey, useRefreshApiKeys, useRevokeApiKey } from "./queries";
import { RevokeApiKeyDialog } from "./RevokeApiKeyDialog";
import type { ApiKey, NewApiKey } from "./types";

const DUPLICATE_NAME = "An API key with this name already exists.";

/** Container for `/settings/api-keys`: list, create-once dialog and revocation. */
export function ApiKeysContainer() {
  const apiKeys = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const refresh = useRefreshApiKeys();
  const now = useNow(60_000);
  const [creating, setCreating] = useState(false);
  // The full secret lives only here, only while the one-time view is open.
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | undefined>(undefined);
  // Persistent polite live region: announces outcomes that otherwise only change the list.
  const [notice, setNotice] = useState("");
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const revokingNow = useRef(false);
  const [revokeInFlight, setRevokeInFlight] = useState(false);
  const shownRevoke = useRef<ApiKey | undefined>(undefined);
  // The revoked row loses its button; once the dialog is gone, hand focus to the page title.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);

  useEffect(() => {
    if (!focusTitle.current || revoking) return;
    focusTitle.current = false;
    titleRef.current?.focus();
  });

  function openCreate() {
    create.reset();
    setSecret(null);
    setCreating(true);
  }

  async function submitCreate(input: NewApiKey) {
    if (create.isPending) return;
    try {
      const result = await create.mutateAsync(input);
      setSecret(result.key);
      setNotice(`Created ${result.name}.`);
    } catch {
      // Shown through the mutation's error state inside the dialog.
    }
  }

  /** Closing forgets the secret (state and mutation result) and refreshes the list. */
  function closeCreate() {
    if (create.isPending) return;
    const hadKey = secret !== null;
    setSecret(null);
    create.reset();
    setCreating(false);
    if (hadKey) void refresh();
  }

  function showRevoke(key: ApiKey | undefined) {
    shownRevoke.current = key;
    setRevoking(key);
  }

  async function confirmRevoke(key: ApiKey) {
    if (revokingNow.current) return;
    revokingNow.current = true;
    setRevokeInFlight(true);
    try {
      await revoke.mutateAsync(key);
      setNotice(`Revoked ${key.name}.`);
      if (shownRevoke.current?.id === key.id) {
        focusTitle.current = true;
        showRevoke(undefined);
      }
    } catch {
      // Shown through the mutation's error state while its dialog is open.
    } finally {
      // mutateAsync, not mutate's onSettled: `revoke.reset()` drops pending mutate callbacks.
      revokingNow.current = false;
      setRevokeInFlight(false);
    }
  }

  const createError = create.isError ? formErrorView(create.error, DUPLICATE_NAME) : undefined;
  const list = apiKeys.data ?? [];
  let body;
  if (apiKeys.isPending) {
    body = <Spinner label="Loading API keys" />;
  } else if (apiKeys.isError) {
    body = (
      <Alert title="Could not load API keys">
        <span className="block">{errorMessage(apiKeys.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => apiKeys.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        icon={<KeyIcon size={22} />}
        title="No API keys yet"
        description="Create a key so CI, scripts or a coding agent can launch runs and read results without signing in."
        action={
          <Button icon={<PlusIcon size={16} />} onClick={openCreate}>
            Create your first API key
          </Button>
        }
      />
    );
  } else {
    body = (
      <ApiKeysTable
        apiKeys={list}
        now={now}
        onRevoke={(key) => {
          revoke.reset();
          showRevoke(key);
        }}
      />
    );
  }

  return (
    <>
      <PageHeader
        titleRef={titleRef}
        title="API keys"
        description="Keys act as you on the API. The full key is shown once, when it is created."
        actions={
          <Button icon={<PlusIcon size={16} />} onClick={openCreate}>
            Create API key
          </Button>
        }
      />
      <p role="status" className="sr-only">
        {notice}
      </p>
      {body}

      <Dialog
        open={creating}
        size="lg"
        title={secret === null ? "Create API key" : "Copy your new API key"}
        description={
          secret === null ? "Use it as a Bearer token in the Authorization header." : undefined
        }
        onClose={closeCreate}
      >
        {secret === null ? (
          <CreateApiKeyForm
            onSubmit={(input) => void submitCreate(input)}
            onCancel={closeCreate}
            pending={create.isPending}
            error={createError?.message}
            nameError={createError?.fieldErrors.name}
          />
        ) : (
          <CreatedApiKeyView secret={secret} origin={window.location.origin} onDone={closeCreate} />
        )}
      </Dialog>

      <RevokeApiKeyDialog
        apiKey={revoking}
        onCancel={() => showRevoke(undefined)}
        onConfirm={confirmRevoke}
        pending={revokeInFlight}
        error={revoke.isError ? errorMessage(revoke.error) : undefined}
      />
    </>
  );
}
