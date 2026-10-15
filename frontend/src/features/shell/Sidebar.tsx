import Link from "next/link";
import { useT } from "@/lib/i18n";
import { confirmLeave } from "@/lib/navigation/unsaved-changes";
import { cn, ExternalLinkIcon, focusRing } from "@/ui";
import { ThemeControl } from "@/features/theme/ThemeControl";
import { Brand } from "./Brand";
import { EnvironmentBadge } from "./EnvironmentBadge";
import { LanguageControl } from "./LanguageControl";
import { activeHref, NAV_PRIMARY, NAV_SECONDARY, type NavItem } from "./navigation";
import { UserMenu, type ShellUser } from "./UserMenu";

type SidebarProps = {
  pathname: string;
  environmentLabel: string;
  /** Counts shown as an amber pill on a nav item, by href (e.g. active runs on "/live"); 0 hides it. */
  badges?: Partial<Record<string, number>>;
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
  badges,
  user,
  onSignOut,
  signingOut,
  signOutError,
  accountUnavailable,
  onNavigate,
  id,
  className,
}: SidebarProps) {
  const t = useT();
  const current = activeHref(pathname, [...NAV_PRIMARY, ...NAV_SECONDARY]);
  const link = (item: NavItem) => (
    <NavLink
      key={item.href}
      item={item}
      current={item.href === current}
      badge={badges?.[item.href]}
      onNavigate={onNavigate}
    />
  );

  return (
    <div id={id} className={cn("flex flex-col gap-6 bg-sidebar px-3.5 py-5", className)}>
      <div className="hidden md:block">
        <Brand />
      </div>
      <EnvironmentBadge label={environmentLabel} />
      <nav aria-label={t("nav.primary")} className="flex flex-1 flex-col gap-6">
        <ul className="flex flex-col gap-0.5">{NAV_PRIMARY.map(link)}</ul>
        <ul className="mt-auto flex flex-col gap-0.5">
          {NAV_SECONDARY.map(link)}
          <li>
            {/* Served by the backend (Swagger UI), so a plain link, not a client-side one. */}
            <a
              href="/api/docs"
              target="_blank"
              aria-label={t("nav.apiDocsNewTab")}
              rel="noopener noreferrer"
              className={cn(
                "flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-muted no-underline transition-colors",
                "hover:bg-active/60 hover:text-fg",
                focusRing,
              )}
            >
              <ExternalLinkIcon size={18} />
              {t("nav.apiDocs")} <span aria-hidden="true">↗</span>
            </a>
          </li>
          <li>
            {/* The public guide has its own layout, outside the app shell. */}
            <Link
              href="/guide"
              onClick={onNavigate}
              onNavigate={(event) => {
                if (!confirmLeave()) event.preventDefault();
              }}
              className={cn(
                "flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-muted no-underline transition-colors",
                "hover:bg-active/60 hover:text-fg",
                focusRing,
              )}
            >
              <GuideIcon />
              {t("nav.guide")}
            </Link>
          </li>
        </ul>
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <ThemeControl />
        <LanguageControl />
      </div>
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

type NavLinkProps = { item: NavItem; current: boolean; badge?: number; onNavigate?: () => void };

function NavLink({ item, current, badge, onNavigate }: NavLinkProps) {
  const t = useT();
  const label = t(item.label);
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={current ? "page" : undefined}
        // The pill is only a number; the name says what it counts.
        aria-label={badge ? t.plural("nav.activeRuns", badge, { label }) : undefined}
        onClick={onNavigate}
        // Asks before discarding an editor's unsaved changes (client-side navigations only).
        onNavigate={(event) => {
          if (!confirmLeave()) event.preventDefault();
        }}
        className={cn(
          "flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium no-underline transition-colors",
          focusRing,
          item.nested && "ml-5",
          current ? "bg-active text-fg hover:text-fg" : "text-muted hover:bg-active/60 hover:text-fg",
        )}
      >
        <Icon size={item.nested ? 16 : 18} />
        <span className="flex-1">{label}</span>
        {badge ? (
          <span
              aria-hidden="true"
              className="rounded-full bg-evaluator/16 px-[7px] py-0.5 font-mono text-[11px] text-evaluator-fg"
            >
            {badge}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function GuideIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </svg>
  );
}
