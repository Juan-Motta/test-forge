import type { ConnectionKind } from "./types";

/** How a config value is checked (mirrors the backend's field types). */
export type FieldFormat = "url" | "identifier" | "region";

export type ConfigField = {
  /** camelCase key, as the API expects it. */
  key: string;
  label: string;
  format: FieldFormat;
  required: boolean;
  /** Prefilled on create (the backend's own default). */
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
};

export type KindDefinition = {
  label: string;
  description: string;
  config: ConfigField[];
  secret: { key: string; label: string };
  /** Azure AI Speech: exactly one of these two keys must be set. */
  exactlyOneOf?: [string, string];
};

export const KINDS: Record<ConnectionKind, KindDefinition> = {
  openai: {
    label: "OpenAI",
    description: "OpenAI API or a compatible proxy.",
    config: [
      {
        key: "baseUrl",
        label: "Base URL",
        format: "url",
        required: false,
        defaultValue: "https://api.openai.com/v1",
        placeholder: "https://api.openai.com/v1",
      },
      { key: "ttsModel", label: "TTS model", format: "identifier", required: false, defaultValue: "gpt-4o-mini-tts" },
      { key: "ttsVoice", label: "TTS voice", format: "identifier", required: false, defaultValue: "alloy" },
    ],
    secret: { key: "apiKey", label: "API key" },
  },
  azure_openai: {
    label: "Azure OpenAI",
    description: "An Azure OpenAI resource with a TTS deployment.",
    config: [
      {
        key: "endpoint",
        label: "Endpoint",
        format: "url",
        required: true,
        placeholder: "https://my-resource.openai.azure.com",
      },
      { key: "apiVersion", label: "API version", format: "identifier", required: true, placeholder: "2025-03-01-preview" },
      { key: "ttsDeployment", label: "TTS deployment", format: "identifier", required: true },
      { key: "ttsVoice", label: "TTS voice", format: "identifier", required: false, defaultValue: "alloy" },
    ],
    secret: { key: "apiKey", label: "API key" },
  },
  azure_speech: {
    label: "Azure AI Speech",
    description: "An Azure AI Speech resource, by region or custom endpoint.",
    config: [
      {
        key: "region",
        label: "Region",
        format: "region",
        required: false,
        placeholder: "eastus",
        hint: "Azure region name. Use this or an endpoint.",
      },
      {
        key: "endpoint",
        label: "Endpoint",
        format: "url",
        required: false,
        placeholder: "https://eastus.api.cognitive.microsoft.com",
        hint: "Custom endpoint. Use this or a region.",
      },
      { key: "voice", label: "Voice", format: "identifier", required: false, placeholder: "es-MX-DaliaNeural" },
    ],
    secret: { key: "key", label: "Key" },
    exactlyOneOf: ["region", "endpoint"],
  },
  langfuse: {
    label: "Langfuse",
    description: "Langfuse project for traces.",
    config: [
      { key: "host", label: "Host", format: "url", required: true, placeholder: "https://cloud.langfuse.com" },
      { key: "publicKey", label: "Public key", format: "identifier", required: true, placeholder: "pk-lf-…" },
    ],
    secret: { key: "secretKey", label: "Secret key" },
  },
};

export function kindLabel(kind: string): string {
  return kind in KINDS ? KINDS[kind as ConnectionKind].label : kind;
}
