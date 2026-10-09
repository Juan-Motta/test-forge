import type { ComponentType } from "react";
import {
  AgentsIcon,
  ConnectionsIcon,
  LiveIcon,
  OverviewIcon,
  RunsIcon,
  ScenariosIcon,
  SettingsIcon,
} from "@/ui";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** Rendered indented under its parent (e.g. Connections under Settings). */
  nested?: boolean;
};

export const NAV_PRIMARY: NavItem[] = [
  { href: "/", label: "Overview", icon: OverviewIcon },
  { href: "/live", label: "Live sessions", icon: LiveIcon },
  { href: "/runs", label: "Runs & reports", icon: RunsIcon },
  { href: "/scenarios", label: "Scenarios", icon: ScenariosIcon },
  { href: "/agents", label: "Agents", icon: AgentsIcon },
];

export const NAV_SECONDARY: NavItem[] = [
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/settings/connections", label: "Connections", icon: ConnectionsIcon, nested: true },
];

/** The most specific item matching the path (exact or ancestor), or null. */
export function activeHref(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const { href } of items) {
    const matches = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
