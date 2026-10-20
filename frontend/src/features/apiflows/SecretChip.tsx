"use client";

import { useT } from "@/lib/i18n";
import { EyeIcon, EyeOffIcon, IconButton, Spinner, cn } from "@/ui";

type SecretChipProps = {
  name: string;
  /** The masked hint the API lists (`••••7890`). */
  hint: string;
  /** The value in clear while revealed; undefined while hidden. */
  value?: string;
  pending?: boolean;
  onToggle: () => void;
};

/** A credential as `name ••••hint`, with an eye that shows its value and hides it again. */
export function SecretChip({ name, hint, value, pending = false, onToggle }: SecretChipProps) {
  const t = useT();
  const revealed = value !== undefined;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-field-line bg-field py-0.5 pr-1 pl-2.5 font-mono text-xs">
      <span className="text-fg">{name}</span>
      <span className={cn("break-all", revealed ? "text-fg" : "text-dim")}>{revealed ? value : hint}</span>
      <IconButton
        size="xs"
        label={t(revealed ? "ui.hideSecret" : "ui.showSecret", { subject: name })}
        aria-pressed={revealed}
        aria-busy={pending || undefined}
        icon={pending ? <Spinner size={12} /> : revealed ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
        onClick={pending ? undefined : onToggle}
      />
    </span>
  );
}
