export function EnvironmentBadge({ label }: { label: string }) {
  return (
    <p className="flex min-h-11 items-center gap-2 rounded-lg border border-[#262a30] bg-panel px-3 text-[13px]">
      <span aria-hidden="true" className="size-2 rounded-full bg-success" />
      <span>Environment · {label}</span>
    </p>
  );
}
