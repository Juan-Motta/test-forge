"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, Field, Input, Textarea } from "@/ui";
import { parseTags } from "./form-schema";
import type { NewGroup } from "./types";

const MAX_TITLE = 160;
const MAX_DESCRIPTION = 4000;
const MAX_TAGS = 20;
const MAX_TAG = 40;

type GroupFormProps = {
  id: string;
  initial?: NewGroup;
  /** Saves the group; a rejection carries the API error (409 means the title is taken). */
  onSubmit: (group: NewGroup) => Promise<unknown>;
  /** The form's buttons; the submit one names `id` in its `form` attribute. */
  actions: ReactNode;
};

/** A group's title, description and tags: the fields of New group and of the group's page. */
export function GroupForm({ id, initial, onSubmit, actions }: GroupFormProps) {
  const t = useT();
  const [title, setTitle] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [errors, setErrors] = useState<{ title?: string; description?: string; tags?: string; other?: string }>({});

  function problems() {
    const found: typeof errors = {};
    const parsed = parseTags(tags);
    if (!title.trim()) found.title = t("groups.error.title");
    else if (title.trim().length > MAX_TITLE) found.title = t("common.maxChars", { max: MAX_TITLE });
    if (description.trim().length > MAX_DESCRIPTION) found.description = t("common.maxChars", { max: MAX_DESCRIPTION });
    if (parsed.length > MAX_TAGS) found.tags = t("scenarios.error.maxTags", { max: MAX_TAGS });
    else if (parsed.some((tag) => tag.length > MAX_TAG)) found.tags = t("common.maxChars", { max: MAX_TAG });
    return found;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = problems();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await onSubmit({ name: title.trim(), description: description.trim(), tags: parseTags(tags) });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setErrors({ title: t("groups.error.taken") });
      else setErrors({ other: errorMessage(error) });
    }
  }

  return (
    <form id={id} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {errors.other ? <Alert>{errors.other}</Alert> : null}
      <Field label={t("groups.field.title")} error={errors.title}>
        {(props) => <Input autoComplete="off" value={title} onChange={(event) => setTitle(event.target.value)} {...props} />}
      </Field>
      <Field label={t("groups.field.description")} hint={t("groups.field.descriptionHint")} error={errors.description}>
        {(props) => (
          <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} {...props} />
        )}
      </Field>
      <Field label={t("scenarios.field.tags")} hint={t("groups.field.tagsHint")} error={errors.tags}>
        {(props) => (
          <Input mono autoComplete="off" spellCheck={false} value={tags} onChange={(event) => setTags(event.target.value)} {...props} />
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-3">{actions}</div>
    </form>
  );
}
