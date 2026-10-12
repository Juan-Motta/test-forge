import type { ReactNode } from "react";
import { absoluteTime, relativeTime } from "@/features/connections/format";
import { Badge, type BadgeTone, Button } from "@/ui";
import { apiKeyStatus, maskedPrefix, statusLabel } from "./format";
import type { ApiKey, ApiKeyStatus } from "./types";

type ApiKeysTableProps = {
  apiKeys: ApiKey[];
  onRevoke: (key: ApiKey) => void;
  /** Current time (ms) for statuses and relative times. */
  now: number;
};

const STATUS_TONES: Record<ApiKeyStatus, BadgeTone> = { active: "success", revoked: "neutral", expired: "danger" };

/** Repeats the column header inside each cell where rows become cards (phones). */
function CellLabel({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="mb-1 block text-xs font-medium text-dim md:hidden">
      {children}
    </span>
  );
}

/** An absolute date, or a relative one when `now` is given; "Never" when there is none. */
function When({ iso, now }: { iso: string | null; now?: number }) {
  if (!iso) return <span className="text-xs text-muted">Never</span>;
  return (
    <time dateTime={iso} title={absoluteTime(iso)} className="text-xs text-muted">
      {now === undefined ? absoluteTime(iso) : relativeTime(iso, now)}
    </time>
  );
}

const HEAD = "px-4 py-3 text-left text-xs font-medium text-dim";
const CELL = "align-top md:px-4 md:py-3.5";

/**
 * A table on wide screens; on phones every row restyles into a card. Changing `display` makes
 * some browsers (Safari) drop the implicit table roles, so every element states its role.
 */
export function ApiKeysTable({ apiKeys, onRevoke, now }: ApiKeysTableProps) {
  return (
    <div className="md:-mx-5 md:-mb-5 md:overflow-x-auto md:border-t md:border-line">
      <table role="table" className="w-full text-sm max-md:block">
        <caption className="sr-only">API keys</caption>
        <thead role="rowgroup" className="border-b border-line max-md:sr-only">
          <tr role="row">
            <th scope="col" role="columnheader" className={HEAD}>Name</th>
            <th scope="col" role="columnheader" className={HEAD}>Key</th>
            <th scope="col" role="columnheader" className={HEAD}>Created</th>
            <th scope="col" role="columnheader" className={HEAD}>Last used</th>
            <th scope="col" role="columnheader" className={HEAD}>Expires</th>
            <th scope="col" role="columnheader" className={HEAD}>Status</th>
            <th scope="col" role="columnheader" className={HEAD}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-md:flex max-md:flex-col max-md:gap-3">
          {apiKeys.map((apiKey) => {
            const status = apiKeyStatus(apiKey, now);
            return (
              <tr
                key={apiKey.id}
                role="row"
                className="border-line md:border-t md:first:border-t-0 max-md:grid max-md:grid-cols-2 max-md:gap-4 max-md:rounded-xl max-md:border max-md:bg-panel max-md:p-4"
              >
                <th scope="row" role="rowheader" className={`${CELL} text-left font-semibold break-words max-md:col-span-2`}>
                  {apiKey.name}
                </th>
                <td role="cell" className={CELL}>
                  <CellLabel>Key</CellLabel>
                  <span className="font-mono text-xs text-muted">{maskedPrefix(apiKey.prefix)}</span>
                </td>
                <td role="cell" className={CELL}>
                  <CellLabel>Created</CellLabel>
                  <When iso={apiKey.createdAt} />
                </td>
                <td role="cell" className={CELL}>
                  <CellLabel>Last used</CellLabel>
                  <When iso={apiKey.lastUsedAt} now={now} />
                </td>
                <td role="cell" className={CELL}>
                  <CellLabel>Expires</CellLabel>
                  <When iso={apiKey.expiresAt} />
                </td>
                <td role="cell" className={CELL}>
                  <CellLabel>Status</CellLabel>
                  <Badge tone={STATUS_TONES[status]}>{statusLabel(status)}</Badge>
                </td>
                <td role="cell" className={`${CELL} max-md:col-span-2`}>
                  {status === "revoked" ? null : (
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <Button variant="ghost" aria-label={`Revoke ${apiKey.name}`} onClick={() => onRevoke(apiKey)}>
                        Revoke
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
