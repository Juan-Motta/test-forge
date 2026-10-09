import { ApiError, type FieldErrors } from "@/lib/api";

export const DUPLICATE_NAME = "A connection with this name already exists.";
const GENERIC = "Something went wrong. Try again.";

/** How a failed save or test shows up in the form: a form-level message and per-field errors. */
export type FormErrorView = { message?: string; fieldErrors: FieldErrors };

export function formErrorView(error: unknown): FormErrorView {
  if (!(error instanceof ApiError)) return { message: GENERIC, fieldErrors: {} };
  if (error.status === 409) return { fieldErrors: { name: DUPLICATE_NAME } };
  if (error.status === 422) return { message: "Check the highlighted fields.", fieldErrors: error.fieldErrors };
  return { message: error.message, fieldErrors: {} };
}

/** A one-line reason for a failed request (list load, row test, delete). */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : GENERIC;
}
