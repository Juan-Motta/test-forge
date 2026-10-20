"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "@/lib/i18n";
import { Badge, CloseIcon, IconButton, PencilIcon, PlusIcon, cn, focusRing } from "@/ui";

const MAX_DESCRIPTION = 4000;
const MAX_TAGS = 20;
const MAX_TAG = 40;

type Commit<T> = (next: T) => Promise<string | undefined> | string | undefined;

/** Runs a commit, turning a thrown error into its message: a failed save is reported, never lost. */
async function attempt<T>(commit: Commit<T>, next: T): Promise<string | undefined> {
  try {
    return await commit(next);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Under a group's title: its description with a pencil at the end (a field while editing:
 * leaving it or Ctrl/Cmd+Enter keeps it, Escape restores it), then its tags with "Add tag".
 */
export function GroupMeta({
  description,
  tags,
  onDescription,
  onTags,
  descriptionPlaceholder,
  tagsLabel,
}: {
  description: string;
  tags: string[];
  onDescription: Commit<string>;
  onTags: Commit<string[]>;
  /** Wording for what is not a scenario group (defaults: the group's). */
  descriptionPlaceholder?: string;
  tagsLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <EditableDescription value={description} onCommit={onDescription} placeholder={descriptionPlaceholder} />
      <TagEditor tags={tags} onCommit={onTags} label={tagsLabel} />
    </div>
  );
}

function EditableDescription({
  value,
  onCommit,
  placeholder: given,
}: {
  value: string;
  onCommit: Commit<string>;
  placeholder?: string;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string>();
  const field = useRef<HTMLTextAreaElement>(null);
  // Ctrl/Cmd+Enter then leaving the field would save twice: one save at a time.
  const saving = useRef(false);

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  async function commit() {
    if (saving.current) return;
    const next = draft.trim();
    if (next === value.trim()) return setEditing(false);
    if (next.length > MAX_DESCRIPTION) return setError(t("common.maxChars", { max: MAX_DESCRIPTION }));
    saving.current = true;
    const problem = await attempt(onCommit, next);
    saving.current = false;
    if (problem) return setError(problem);
    setEditing(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setError(undefined);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <span className="flex flex-col gap-1">
        <textarea
          ref={field}
          aria-label={t("groups.editDescription")}
          aria-invalid={error ? true : undefined}
          rows={3}
          value={draft}
          placeholder={given ?? t("groups.descriptionPlaceholder")}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(undefined);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => void commit()}
          className="w-full max-w-3xl rounded-lg border border-field-border bg-field px-3 py-2 text-sm text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-evaluator/40"
        />
        {error ? <span className="text-xs text-danger-fg">{error}</span> : null}
      </span>
    );
  }
  return (
    <span className="flex max-w-3xl items-start gap-1.5">
      <span className={cn("text-sm whitespace-pre-line", value ? "text-muted" : "text-dim")}>
        {value || (given ?? t("groups.descriptionPlaceholder"))}
      </span>
      <IconButton
        size="xs"
        label={t("groups.editDescription")}
        icon={<PencilIcon size={13} />}
        onClick={() => {
          setDraft(value);
          setError(undefined);
          setEditing(true);
        }}
      />
    </span>
  );
}

function TagEditor({
  tags: saved,
  onCommit,
  label,
}: {
  tags: string[];
  onCommit: Commit<string[]>;
  label?: string;
}) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const field = useRef<HTMLInputElement>(null);
  // The list as edited here, ahead of the server: quick edits build on each other (never on a
  // stale `saved`), and their saves run one after another in order.
  const [tags, setTags] = useState(saved);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // The server's list: the last one received, plus what the saves that succeeded since left
  // there (a failed save falls back to it, never to an older copy).
  const confirmed = useRef(saved);

  useEffect(() => {
    confirmed.current = saved;
    if (pending.current === 0) setTags(saved);
  }, [saved]);

  useEffect(() => {
    if (adding) field.current?.focus();
  }, [adding]);

  function save(next: string[]): Promise<string | undefined> {
    setTags(next);
    pending.current += 1;
    const done = queue.current.then(async () => {
      const problem = await attempt(onCommit, next);
      pending.current -= 1;
      if (problem) {
        setError(problem);
        if (pending.current === 0) setTags(confirmed.current);
      } else {
        confirmed.current = next;
      }
      return problem;
    });
    queue.current = done;
    return done;
  }

  async function add() {
    const tag = draft.trim();
    if (!tag) return setAdding(false);
    if (tag.length > MAX_TAG) return setError(t("common.maxChars", { max: MAX_TAG }));
    if (tags.length >= MAX_TAGS) return setError(t("scenarios.error.maxTags", { max: MAX_TAGS }));
    if (!tags.includes(tag) && (await save([...tags, tag]))) return;
    // (the field stays open for the next tag)
    setDraft("");
    setError(undefined);
    field.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void add();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDraft("");
      setError(undefined);
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <ul aria-label={label ?? t("groups.tagsLabel")} className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <li key={tag}>
            <Badge tone="outline" mono className="gap-1 pr-1">
              {tag}
              <button
                type="button"
                aria-label={t("groups.removeTag", { tag })}
                onClick={() => void save(tags.filter((item) => item !== tag))}
                className={cn("inline-flex size-4 items-center justify-center rounded-full text-dim hover:text-fg", focusRing)}
              >
                <CloseIcon size={10} />
              </button>
            </Badge>
          </li>
        ))}
        <li>
          {adding ? (
            <input
              ref={field}
              aria-label={t("groups.newTag")}
              value={draft}
              maxLength={MAX_TAG}
              placeholder={t("groups.newTagPlaceholder")}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(undefined);
              }}
              onKeyDown={onKeyDown}
              onBlur={() => void add().then(() => setAdding(false))}
              className="h-7 w-36 rounded-full border border-field-border bg-field px-3 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-evaluator/40"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-xs text-muted hover:text-fg",
                focusRing,
              )}
            >
              <PlusIcon size={12} />
              {t("groups.addTag")}
            </button>
          )}
        </li>
      </ul>
      {error ? <span className="text-xs text-danger-fg">{error}</span> : null}
    </div>
  );
}
