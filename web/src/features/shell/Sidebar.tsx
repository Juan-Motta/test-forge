import Link from "next/link";
import { cn, focusRing } from "@/ui";
import { Brand } from "./Brand";
import { EnvironmentBadge } from "./EnvironmentBadge";
import { activeHref, NAV_PRIMARY, NAV_SECONDARY, type NavItem } from "./navigation";
import { UserMenu, type ShellUser } from "./UserMenu";

type SidebarProps = {
  pathname: string;
  environmentLabel: string;
  user: ShellUser | undefined;
  onSignOut: () => void;
  signingOut: boolean;
  signOutError?: string;
  accountUnavailable?: boolean;
  /** Called when a link is followed (the mobile drawer closes on it). */
  onNavigate?: () => void;
  id?: string;
  className?: string;
};

export function Sidebar({
  pathname,
  environmentLabel,
  user,
  onSignOut,
  signingOut,
  signOutError,
  accountUnavailable,
  onNavigate,
  id,
  className,
}: SidebarProps) {
  const current = activeHref(pathname, [...NAV_PRIMARY, ...NAV_SECONDARY]);
  const link = (item: NavItem) => (
    <NavLink key={item.href} item={item} current={item.href === current} onNavigate={onNavigate} />
  );

  return (
    <div id={id} className={cn("flex flex-col gap-6 bg-sidebar px-3.5 py-5", className)}>
      <div className="hidden md:block">
        <Brand />
      </div>
      <EnvironmentBadge label={environmentLabel} />
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-6">
        <ul className="flex flex-col gap-0.5">{NAV_PRIMARY.map(link)}</ul>
        <ul className="mt-auto flex flex-col gap-0.5">{NAV_SECONDARY.map(link)}</ul>
      </nav>
      <UserMenu
        user={user}
        onSignOut={onSignOut}
        signingOut={signingOut}
        signOutError={signOutError}
        accountUnavailable={accountUnavailable}
      />
    </div>
  );
}

function NavLink({ item, current, onNavigate }: { item: NavItem; current: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={current ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium no-underline transition-colors",
          focusRing,
          item.nested && "ml-5",
          current ? "bg-active text-fg hover:text-fg" : "text-muted hover:bg-active/60 hover:text-fg",
        )}
      >
        <Icon size={item.nested ? 16 : 18} />
        {item.label}
      </Link>
    </li>
  );
}
