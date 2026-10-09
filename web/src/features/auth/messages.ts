import { ApiError } from "@/lib/api";

export const INVALID_CREDENTIALS = "Invalid email or password.";
const GENERIC = "Could not sign you in. Try again.";

function minutes(seconds: number): string {
  const n = Math.max(1, Math.ceil(seconds / 60));
  return n === 1 ? "1 minute" : `${n} minutes`;
}

/** What the login page says about a failed attempt. Never reveals whether the email exists. */
export function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC;
  switch (error.status) {
    case 401:
      return INVALID_CREDENTIALS;
    case 429:
      return error.retryAfterSeconds === undefined
        ? "Too many attempts, try again later."
        : `Too many attempts, try again in ${minutes(error.retryAfterSeconds)}.`;
    case 0:
      return error.message;
    case 422:
      return "Check the highlighted fields.";
    default:
      return GENERIC;
  }
}
