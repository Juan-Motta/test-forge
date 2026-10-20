"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { PlusIcon, SearchField, cn, focusRing } from "@/ui";
import type { Api } from "./types";

/** The APIs whose name, base URL, description or a tag holds the search. */
export function searchApis(apis: Api[], search: string): Api[] {
  const wanted = search.trim().toLowerCase();
  if (!wanted) return apis;
  return apis.filter(
    (api) =>
      api.name.toLowerCase().includes(wanted) ||
      api.baseUrl.toLowerCase().includes(wanted) ||
      api.description.toLowerCase().includes(wanted) ||
      api.tags.some((tag) => tag.toLowerCase().includes(wanted)),
  );
}

type ApisRailProps = {
  apis: Api[];
  selectedId: string;
  onSelect: (api: Api) => void;
  onNew: () => void;
};

/** The master list of `/apis`: a search, one card per API (the open one marked current) and New API. */
export function ApisRail({ apis, selectedId, onSelect, onNew }: ApisRailProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const visible = searchApis(apis, query);

  return (
    <aside aria-label={t("apis.railLabel")} className="flex min-w-0 flex-col gap-3.5 lg:w-64 lg:shrink-0">
      <SearchField
        label={t("apis.search")}
        placeholder={t("apis.searchPlaceholder")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="bg-panel"
      />
      {visible.length === 0 ? (
        <p className="px-1 text-xs text-muted">{t("apis.noMatch")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visible.map((api) => {
            const selected = api.id === selectedId;
            return (
              <li key={api.id}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(api)}
                  className={cn(
                    "flex w-full min-h-11 flex-col gap-1 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                    selected ? "border-line-strong bg-active" : "border-transparent hover:bg-active/60",
                    focusRing,
                  )}
                >
                  <span className="text-[13px] font-semibold break-words text-fg">{api.name}</span>
                  <span className="font-mono text-[11px] break-all text-muted">{api.baseUrl}</span>
                  <span className="text-xs text-dim">
                    {t.plural("apis.secretCount", api.secrets.length)} · {t.plural("apis.flowCount", api.flowCount)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={onNew}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-[13px] text-muted hover:text-fg",
          focusRing,
        )}
      >
        <PlusIcon size={14} />
        {t("apis.new")}
      </button>
    </aside>
  );
}
