"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage, formErrorView } from "@/lib/api";
import { localizeFormError, useT } from "@/lib/i18n";
import { useOrigin } from "@/lib/browser/use-origin";
import { useNow } from "@/lib/time/use-now";
import { Alert, Button, Card, CardHeader, Dialog, EmptyState, ExternalLinkIcon, PlusIcon, SegmentedControl, Spinner, buttonClasses } from "@/ui";
import { AgentSkillContainer } from "./AgentSkillContainer";
import { ApiKeysTable } from "./ApiKeysTable";
import { apiKeyStatus } from "./format";
import { CreateApiKeyForm } from "./CreateApiKeyForm";
import { CreatedApiKeyView } from "./CreatedApiKeyView";
import { KeyIcon } from "./KeyIcon";
import { useApiKeys, useCreateApiKey, useRefreshApiKeys, useRevokeApiKey } from "./queries";
import { RevokeApiKeyDialog } from "./RevokeApiKeyDialog";
import type { ApiKey, NewApiKey } from "./types";

const KEY_VIEWS = ["active", "revoked", "all"] as const;
type KeyView = (typeof KEY_VIEWS)[number];

/** Container for `/settings/api-keys`: list, create-once dialog and revocation. */
export function ApiKeysContainer() {
  const t = useT();
  const origin = useOrigin();
  const apiKeys = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const refresh = useRefreshApiKeys();
  const now = useNow(60_000);
  const keysHeadingId = useId();
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
      setNotice(t("common.created", { name: result.name }));
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
      setNotice(t("apiKeys.revoked", { name: key.name }));
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

  const createError = create.isError
    ? localizeFormError(t, create.error, formErrorView(create.error, t("apiKeys.duplicateName")))
    : undefined;
  const [view, setView] = useState<KeyView>("active");
  const list = apiKeys.data ?? [];
  // Active by default: revoked keys are history. Expired keys show under All only.
  const shownKeys = view === "all" ? list : list.filter((key) => apiKeyStatus(key, now) === view);
  let body;
  if (apiKeys.isPending) {
    body = <Spinner label={t("apiKeys.loading")} />;
  } else if (apiKeys.isError) {
    body = (
      <Alert title={t("apiKeys.loadFailed")}>
        <span className="block">{errorMessage(apiKeys.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => apiKeys.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        icon={<KeyIcon size={22} />}
        title={t("apiKeys.emptyTitle")}
        description={t("apiKeys.emptyDescription")}
        action={
          <Button icon={<PlusIcon size={16} />} onClick={openCreate}>
            {t("apiKeys.createFirst")}
          </Button>
        }
      />
    );
  } else {
    body = (
      <Card aria-labelledby={keysHeadingId}>
        <CardHeader
          id={keysHeadingId}
          title={t("apiKeys.yourKeys")}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-dim">{t.plural("apiKeys.count", shownKeys.length)}</span>
              <SegmentedControl
                label={t("apiKeys.view.label")}
                options={KEY_VIEWS.map((value) => ({ value, label: t(`apiKeys.view.${value}`) }))}
                value={view}
                onChange={setView}
              />
            </div>
          }
        />
        {shownKeys.length === 0 ? (
          <p className="px-1 py-4 text-sm text-muted">{t(`apiKeys.view.empty.${view}`)}</p>
        ) : (
          <ApiKeysTable
            apiKeys={shownKeys}
            now={now}
            onRevoke={(key) => {
              revoke.reset();
              showRevoke(key);
            }}
          />
        )}
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        titleRef={titleRef}
        breadcrumbs={[{ label: t("nav.settings"), href: "/settings" }]}
        title={t("nav.apiKeys")}
        description={t("apiKeys.description")}
        actions={
          <>
            {/* Served by the backend (Swagger UI), so a plain link, not a client-side one. */}
            <a
              href="/api/docs"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("nav.apiDocsNewTab")}
              className={buttonClasses("secondary", "no-underline")}
            >
              <ExternalLinkIcon size={16} />
              {t("nav.apiDocs")}
            </a>
            <Button icon={<PlusIcon size={16} />} onClick={openCreate}>
              {t("apiKeys.create")}
            </Button>
          </>
        }
      />
      <p role="status" className="sr-only">
        {notice}
      </p>
      {body}
      <AgentSkillContainer />

      <Dialog
        open={creating}
        size="lg"
        title={secret === null ? t("apiKeys.create") : t("apiKeys.copyNew")}
        description={
          secret === null ? t("apiKeys.bearerHint") : undefined
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
          <CreatedApiKeyView secret={secret} origin={origin} onDone={closeCreate} />
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
