import { idByName, parseTransfer, read, toTransferText } from "@/features/transfer/transfer";
import type { Translator } from "@/lib/i18n";
import { initialValues, type AgentFormValues } from "./form-schema";
import { AGENT_KINDS, AGENT_PROTOCOLS, TEXT_AUTHS, TEXT_MODES, type Agent } from "./types";

type Named = { id: string; name: string };

/** An agent as text: its settings and its Langfuse connection by name; never its API key. */
export function agentToText(agent: Agent, langfuseConnections: readonly Named[]): string {
  const langfuse = langfuseConnections.find((connection) => connection.id === agent.langfuseConnectionId)?.name ?? null;
  const voice = agent.kind === "voice";
  return toTransferText("agent", {
    kind: agent.kind,
    name: agent.name,
    context: agent.context,
    baseUrl: agent.baseUrl,
    channelId: agent.channelId,
    ...(voice ? { protocol: agent.protocol, userId: agent.userId } : { textMode: agent.textMode, auth: agent.auth }),
    ...(agent.sessionUrl ? { sessionUrl: agent.sessionUrl } : {}),
    origin: agent.origin,
    langfuseConnection: langfuse,
  });
}

export type AgentImport = { ok: true; values: AgentFormValues; notes: string[] } | { ok: false; error: string };

/**
 * Form values from an exported agent. Unknown or mistyped fields keep the form's defaults; a
 * Langfuse connection is matched by name, and what still needs the user is listed in `notes`.
 */
export function agentFromText(t: Translator, text: string, langfuseConnections: readonly Named[]): AgentImport {
  const parsed = parseTransfer(text, "agent");
  if (!parsed.ok) return { ok: false, error: t(`transfer.error.${parsed.error}`, { kind: t("transfer.kind.agent") }) };
  const data = parsed.data;
  const base = initialValues();
  const values: AgentFormValues = {
    ...base,
    kind: read.oneOf(AGENT_KINDS, data.kind) ?? base.kind,
    name: read.string(data.name) ?? "",
    context: read.string(data.context) ?? "",
    protocol: read.oneOf(AGENT_PROTOCOLS, data.protocol) ?? base.protocol,
    baseUrl: read.string(data.baseUrl) ?? "",
    channelId: read.string(data.channelId) ?? "",
    userId: read.string(data.userId) ?? "",
    sessionUrl: read.string(data.sessionUrl) ?? "",
    textMode: read.oneOf(TEXT_MODES, data.textMode) ?? base.textMode,
    auth: read.oneOf(TEXT_AUTHS, data.auth) ?? base.auth,
    origin: read.string(data.origin) ?? "",
    langfuseConnectionId: idByName(langfuseConnections, data.langfuseConnection) ?? "",
  };
  const notes: string[] = [];
  const langfuse = read.string(data.langfuseConnection);
  if (langfuse && !values.langfuseConnectionId) notes.push(t("transfer.note.missingConnection", { name: langfuse }));
  if (values.kind === "text" && values.auth === "api_key") notes.push(t("transfer.note.apiKey"));
  return { ok: true, values, notes };
}
