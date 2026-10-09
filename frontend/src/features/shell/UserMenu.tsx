import { Alert, IconButton, SignOutIcon, Spinner } from "@/ui";

export type ShellUser = { displayName: string; email: string };

type UserMenuProps = {
  user: ShellUser | undefined;
  onSignOut: () => void;
  signingOut: boolean;
  signOutError?: string;
  /** The account could not be loaded (other than a 401, which already redirects). */
  accountUnavailable?: boolean;
};

export function UserMenu({ user, onSignOut, signingOut, signOutError, accountUnavailable }: UserMenuProps) {
  return (
    <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
      {signOutError ? <Alert className="text-xs">{signOutError}</Alert> : null}
      <div className="flex items-center gap-3 px-2">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-chip text-xs font-semibold"
        >
          {user ? initials(user.displayName) : ""}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          {user ? (
            <>
              <span className="truncate text-sm font-medium">{user.displayName}</span>
              <span className="truncate text-xs text-dim">{user.email}</span>
            </>
          ) : accountUnavailable ? (
            <span className="text-xs text-dim">Account details unavailable</span>
          ) : (
            <Spinner label="Loading account" size={14} />
          )}
        </div>
        <IconButton
          label={signingOut ? "Signing out…" : "Sign out"}
          icon={signingOut ? <Spinner /> : <SignOutIcon />}
          onClick={onSignOut}
          disabled={signingOut}
        />
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
