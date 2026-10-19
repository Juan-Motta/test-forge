import type { MessageKey, Translator } from "@/lib/i18n";
import type { Connection, ConnectionKind } from "./types";
import {
  OPENAI_REALTIME_VOICES,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
  OPENAI_VOICES,
  lacksKnownVoice,
  ttsVoicesFor,
  type KindVoices,
} from "./voices";

/** How a config value is checked (mirrors the backend's field types). */
export type FieldFormat = "url" | "identifier" | "region";

export type ConfigField = {
  /** camelCase key, as the API expects it. */
  key: string;
  /** Message key of the field's label. */
  label: MessageKey;
  format: FieldFormat;
  required: boolean;
  /** Prefilled on create (the backend's own default). */
  defaultValue?: string;
  placeholder?: string;
  /** Message key of the field's hint. */
  hint?: MessageKey;
  /** Picked from a list instead of typed: the values offered, given the form's other config values. */
  choices?: (config: Record<string, unknown>) => readonly string[];
  /** A problem with a value given the other config values (e.g. a voice its model lacks). */
  check?: (t: Translator, value: string, config: Record<string, unknown>) => string | undefined;
};

export type KindDefinition = {
  /** The provider's name (a brand, never translated). */
  label: string;
  /** Message key of what the provider is. */
  description: MessageKey;
  config: ConfigField[];
  secret: { key: string; label: MessageKey };
  /** Azure AI Speech: exactly one of these two keys must be set. */
  exactlyOneOf?: [string, string];
  /** Present when the kind can voice the evaluator: the voices a scenario can pick from. */
  voices?: KindVoices;
};

export const KINDS: Record<ConnectionKind, KindDefinition> = {
  openai: {
    label: "OpenAI",
    description: "connections.kind.openai",
    config: [
      {
        key: "baseUrl",
        label: "connections.field.baseUrl",
        format: "url",
        required: false,
        defaultValue: "https://api.openai.com/v1",
        placeholder: "https://api.openai.com/v1",
      },
      {
        key: "ttsModel",
        label: "connections.field.ttsModel",
        format: "identifier",
        required: false,
        defaultValue: "gpt-4o-mini-tts",
        choices: () => OPENAI_TTS_MODELS,
      },
      {
        key: "ttsVoice",
        label: "connections.field.ttsVoice",
        format: "identifier",
        required: false,
        defaultValue: "alloy",
        choices: (config) => ttsVoicesFor(config.ttsModel),
        check: (t, value, config) =>
          lacksKnownVoice(ttsVoicesFor(config.ttsModel), value)
            ? t("connections.error.modelVoice", { model: String(config.ttsModel), voice: value })
            : undefined,
      },
    ],
    secret: { key: "apiKey", label: "connections.field.apiKey" },
    voices: OPENAI_VOICES,
  },
  azure_openai: {
    label: "Azure OpenAI",
    description: "connections.kind.azure_openai",
    config: [
      {
        key: "endpoint",
        label: "connections.field.endpoint",
        format: "url",
        required: true,
        placeholder: "https://my-resource.openai.azure.com",
      },
      { key: "apiVersion", label: "connections.field.apiVersion", format: "identifier", required: true, placeholder: "2025-03-01-preview" },
      { key: "ttsDeployment", label: "connections.field.ttsDeployment", format: "identifier", required: true },
      {
        key: "ttsVoice",
        label: "connections.field.ttsVoice",
        format: "identifier",
        required: false,
        defaultValue: "alloy",
        choices: () => OPENAI_TTS_VOICES,
      },
      {
        key: "chatDeployment",
        label: "connections.field.chatDeployment",
        format: "identifier",
        required: false,
        hint: "connections.hint.chatDeployment",
      },
      {
        key: "realtimeDeployment",
        label: "connections.field.realtimeMini",
        format: "identifier",
        required: false,
        hint: "connections.hint.realtimeMini",
      },
      {
        key: "realtimeFullDeployment",
        label: "connections.field.realtimeFull",
        format: "identifier",
        required: false,
        hint: "connections.hint.realtimeFull",
      },
    ],
    secret: { key: "apiKey", label: "connections.field.apiKey" },
    voices: OPENAI_VOICES,
  },
  azure_speech: {
    label: "Azure AI Speech",
    description: "connections.kind.azure_speech",
    config: [
      {
        key: "region",
        label: "connections.field.region",
        format: "region",
        required: false,
        placeholder: "eastus",
        hint: "connections.hint.region",
      },
      {
        key: "endpoint",
        label: "connections.field.endpoint",
        format: "url",
        required: false,
        placeholder: "https://eastus.api.cognitive.microsoft.com",
        hint: "connections.hint.endpoint",
      },
      { key: "voice", label: "connections.field.voice", format: "identifier", required: false, placeholder: "es-MX-DaliaNeural" },
    ],
    secret: { key: "key", label: "connections.field.key" },
    exactlyOneOf: ["region", "endpoint"],
  },
  langfuse: {
    label: "Langfuse",
    description: "connections.kind.langfuse",
    config: [
      { key: "host", label: "connections.field.host", format: "url", required: true, placeholder: "https://cloud.langfuse.com" },
      { key: "publicKey", label: "connections.field.publicKey", format: "identifier", required: true, placeholder: "pk-lf-…" },
    ],
    secret: { key: "secretKey", label: "connections.field.secretKey" },
  },
};

export function kindLabel(kind: string): string {
  return kind in KINDS ? KINDS[kind as ConnectionKind].label : kind;
}

/**
 * Whether the connection can act as the evaluator's chat model (mirrors the backend's
 * `chat_model`): OpenAI always (it uses gpt-6-luna), Azure OpenAI only with a chat deployment.
 */
export function canChat(connection: Pick<Connection, "kind" | "config">): boolean {
  if (connection.kind === "openai") return true;
  if (connection.kind === "azure_openai") return Boolean(connection.config.chatDeployment);
  return false;
}

/** Whether a connection of this kind can voice the evaluator (it declares its voices). */
export function canVoice(connection: Pick<Connection, "kind">): boolean {
  return KINDS[connection.kind]?.voices !== undefined;
}

/**
 * The voices a connection can give the evaluator, per evaluator mode: its kind's, narrowed to its
 * TTS model's for OpenAI. `undefined` when it cannot voice the evaluator.
 */
export function connectionVoices(connection: Pick<Connection, "kind" | "config">): KindVoices | undefined {
  if (!canVoice(connection)) return undefined;
  if (connection.kind === "openai") {
    return { pipeline: ttsVoicesFor(connection.config.ttsModel), realtime: OPENAI_REALTIME_VOICES };
  }
  return KINDS[connection.kind].voices;
}
