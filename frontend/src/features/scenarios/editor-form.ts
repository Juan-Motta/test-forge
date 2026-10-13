import { get, type FieldErrors as FormErrors, type Path, type UseFormRegisterReturn } from "react-hook-form";
import type { ScenarioFormValues } from "./form-schema";

/** What every editor section needs from the form: registration that clears its server error, and errors. */
export type SectionProps = {
  registerField: (path: Path<ScenarioFormValues>) => UseFormRegisterReturn;
  fieldError: (path: string) => string | undefined;
};

export function errorAt(errors: FormErrors<ScenarioFormValues>, path: string): string | undefined {
  return (get(errors, path) as { message?: string } | undefined)?.message;
}

const KNOWN_PATH =
  /^(agentId|name|tags|context|persona\.(name|locale|temperament|notes)|ttsConnectionId|evaluatorConnectionId|voiceOverride|evaluatorMode|realtimeModel|goal|instructions|facts(\.\d+\.(key|value))?|criteria(\.\d+\.(text|kind|source|weight))?|endConditions\.(maxDurationS|maxSilenceS|maxTurns|hangUpWhen)|interruptions(\.\d+\.(agentTurn|afterS))?)$/;
const LISTS = new Set(["facts", "criteria", "interruptions"]);

/**
 * Where a server error location (`facts.2.key`, `criteria`, `tags.3`) shows in the form:
 * array-wide errors go to the list's `root`, a single tag to the tags field, an interruption's
 * `afterMs` to its seconds field. `undefined` when
 * the form has no place for it (it is then shown with the form-level message).
 */
export function formPath(apiPath: string): string | undefined {
  const path = apiPath.replace(/^tags\.\d+$/, "tags").replace(/^(interruptions\.\d+\.)afterMs$/, "$1afterS");
  if (!KNOWN_PATH.test(path)) return undefined;
  return LISTS.has(path) ? `${path}.root` : path;
}
