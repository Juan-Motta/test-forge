import type { ComponentType } from "react";
import type { MessageKey } from "@/lib/i18n";
import {
  AgentsIcon,
  ApiFlowsIcon,
  LiveIcon,
  OverviewIcon,
  SettingsIcon,
} from "@/ui";

export type NavItem = {
  href: string;
  /** Dictionary key of the visible name. */
  label: MessageKey;
  /** Top-level items carry an icon; a group's sub-items are indented instead. */
  icon?: ComponentType<{ size?: number }>;
};

/** A collapsible section of the sidebar holding related pages. */
export type NavGroup = {
  /** Stable id, used to remember whether the group is open in this browser. */
  id: string;
  label: MessageKey;
  icon: ComponentType<{ size?: number }>;
  items: NavItem[];
};

export type NavEntry = NavItem | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

export const NAV_PRIMARY: NavEntry[] = [
  { href: "/", label: "nav.overview", icon: OverviewIcon },
  { href: "/live", label: "nav.live", icon: LiveIcon },
  {
    id: "agents",
    label: "nav.agents",
    icon: AgentsIcon,
    items: [
      { href: "/agents", label: "nav.connections" },
      { href: "/scenarios", label: "nav.scenarios" },
      // Agent runs and their reports (`/runs/<id>`).
      { href: "/runs", label: "nav.groupRuns" },
    ],
  },
  {
    id: "api",
    label: "nav.api",
    icon: ApiFlowsIcon,
    items: [
      { href: "/apis", label: "nav.connections" },
      { href: "/flows", label: "nav.flows" },
      { href: "/flow-runs", label: "nav.groupRuns" },
    ],
  },
];

/** Connections, API keys and model prices are reached from the Settings page, which stays marked on them. */
export const NAV_SECONDARY: NavItem[] = [{ href: "/settings", label: "nav.settings", icon: SettingsIcon }];

/** Every link of the entries, with groups flattened into their sub-items. */
export function navItems(entries: NavEntry[]): NavItem[] {
  return entries.flatMap((entry) => (isNavGroup(entry) ? entry.items : [entry]));
}

/** The most specific item matching the path (exact or ancestor), or null. */
export function activeHref(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const { href } of items) {
    const matches = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
