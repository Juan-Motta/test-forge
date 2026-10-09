const GENERIC_MESSAGE = "Something went wrong. Try again.";
const VALIDATION_MESSAGE = "Some fields need attention.";
export const NETWORK_MESSAGE = "Could not reach the server. Check your connection and try again.";

/** Field path (dot-joined `loc` without the leading `body`) to its message. */
export type FieldErrors = Record<string, string>;

/** Every failed API call rejects with this, whatever the cause (HTTP status, network, parsing). */
export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: FieldErrors;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    message: string,
    options: { fieldErrors?: FieldErrors; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = options.fieldErrors ?? {};
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

type ValidationIssue = { loc: unknown[]; msg: string };

function isValidationIssue(value: unknown): value is ValidationIssue {
  if (typeof value !== "object" || value === null) return false;
  const issue = value as Record<string, unknown>;
  return Array.isArray(issue.loc) && typeof issue.msg === "string";
}

function fieldErrorsFrom(detail: unknown): FieldErrors {
  if (!Array.isArray(detail)) return {};
  const errors: FieldErrors = {};
  for (const issue of detail.filter(isValidationIssue)) {
    const path = issue.loc[0] === "body" ? issue.loc.slice(1) : issue.loc;
    const key = path.map(String).join(".") || "_";
    errors[key] ??= issue.msg;
  }
  return errors;
}

/** `Retry-After` is either delay-seconds or an HTTP date. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

/** Builds an `ApiError` from a non-2xx response; never throws. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  let detail: unknown;
  try {
    detail = ((await response.json()) as { detail?: unknown } | null)?.detail;
  } catch {
    detail = undefined;
  }
  const fieldErrors = fieldErrorsFrom(detail);
  const message =
    typeof detail === "string" && detail.trim()
      ? detail
      : Object.keys(fieldErrors).length > 0
        ? VALIDATION_MESSAGE
        : GENERIC_MESSAGE;
  return new ApiError(response.status, message, {
    fieldErrors,
    retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
  });
}
