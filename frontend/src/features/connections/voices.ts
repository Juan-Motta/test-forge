/** Built-in voices of OpenAI's gpt-4o-mini-tts (also served by Azure OpenAI TTS deployments). */
export const OPENAI_TTS_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar",
] as const;

/** Voices the realtime evaluator models (gpt-realtime-2.1-mini and gpt-realtime-2.1) can speak with. */
export const OPENAI_REALTIME_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
] as const;

/** OpenAI's text-to-speech models, newest first (the first is the backend's default). */
export const OPENAI_TTS_MODELS = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"] as const;

/** The older tts-1 and tts-1-hd lack ballad, verse, marin and cedar. */
const LEGACY_TTS_VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"] as const;

/** The voices an OpenAI TTS model speaks with; gpt-4o-mini-tts's for a blank or unknown model. */
export function ttsVoicesFor(model: unknown): readonly string[] {
  return model === "tts-1" || model === "tts-1-hd" ? LEGACY_TTS_VOICES : OPENAI_TTS_VOICES;
}

/** `options` plus `current` when it is not among them, so a stored value stays selectable. */
export function withCurrent(options: readonly string[], current: string | null | undefined): string[] {
  const value = (current ?? "").trim();
  return value && !options.includes(value) ? [...options, value] : [...options];
}

/** The voices a connection kind can give the evaluator, per evaluator mode. */
export type KindVoices = { pipeline: readonly string[]; realtime: readonly string[] };

export const OPENAI_VOICES: KindVoices = { pipeline: OPENAI_TTS_VOICES, realtime: OPENAI_REALTIME_VOICES };
