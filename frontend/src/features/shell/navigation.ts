import type { ComponentType } from "react";
import type { MessageKey } from "@/lib/i18n";
import {
  AgentsIcon,
  ApiFlowsIcon,
  LiveIcon,
  OverviewIcon,
  RunsIcon,
  ScenariosIcon,
  SettingsIcon,
} from "@/ui";

export type NavItem = {
  href: string;
  /** Dictionary key of the visible name. */
  label: MessageKey;
  icon: ComponentType<{ size?: number }>;
};

export const NAV_PRIMARY: NavItem[] = [
  { href: "/", label: "nav.overview", icon: OverviewIcon },
  { href: "/live", label: "nav.live", icon: LiveIcon },
  { href: "/runs", label: "nav.runs", icon: RunsIcon },
  { href: "/scenarios", label: "nav.scenarios", icon: ScenariosIcon },
  { href: "/apis", label: "nav.apis", icon: ApiFlowsIcon },
  { href: "/agents", label: "nav.agents", icon: AgentsIcon },
];

/** Connections, API keys and model prices are reached from the Settings page, which stays marked on them. */
export const NAV_SECONDARY: NavItem[] = [{ href: "/settings", label: "nav.settings", icon: SettingsIcon }];

/** The most specific item matching the path (exact or ancestor), or null. */
export function activeHref(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const { href } of items) {
    const matches = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
