import { ApiError, type FieldErrors } from "./errors";

const GENERIC = "Something went wrong. Try again.";

/** How a failed save shows up in a form: a form-level message and per-field errors. */
export type FormErrorView = { message?: string; fieldErrors: FieldErrors };

/**
 * The backend answers 409 both for a taken name and for other write conflicts; only the first
 * belongs on the name field (`duplicateName` is the message shown there).
 */
export function formErrorView(error: unknown, duplicateName: string): FormErrorView {
  if (!(error instanceof ApiError)) return { message: GENERIC, fieldErrors: {} };
  if (error.status === 409 && /\bname\b/i.test(error.message)) return { fieldErrors: { name: duplicateName } };
  if (error.status === 422) return { message: "Check the highlighted fields.", fieldErrors: error.fieldErrors };
  return { message: error.message, fieldErrors: {} };
}

/** A one-line reason for a failed request (list load, delete, duplicate). */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : GENERIC;
}
