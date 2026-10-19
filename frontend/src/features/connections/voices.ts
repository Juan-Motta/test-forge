/** Built-in voices of OpenAI's gpt-4o-mini-tts (also served by Azure OpenAI TTS deployments). */
export const OPENAI_TTS_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar",
] as const;

/** Voices the realtime evaluator models (gpt-realtime-2.1-mini and gpt-realtime-2.1) can speak with. */
export const OPENAI_REALTIME_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
] as const;

/** The voices a connection kind can give the evaluator, per evaluator mode. */
export type KindVoices = { pipeline: readonly string[]; realtime: readonly string[] };

export const OPENAI_VOICES: KindVoices = { pipeline: OPENAI_TTS_VOICES, realtime: OPENAI_REALTIME_VOICES };
