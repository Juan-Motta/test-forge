import { ApiError, type FieldErrors } from "@/lib/api";
import type { Translator } from "@/lib/i18n";

/** How a failed save or test shows up in the form: a form-level message and per-field errors. */
export type FormErrorView = { message?: string; fieldErrors: FieldErrors };

/** The client's own words in the page language; messages from the API stay as the server wrote them. */
export function formErrorView(t: Translator, error: unknown): FormErrorView {
  if (!(error instanceof ApiError)) return { message: t("common.genericError"), fieldErrors: {} };
  // The backend answers 409 for a taken name and for other write conflicts; only the first
  // belongs on the name field.
  if (error.status === 409 && /\bname\b/i.test(error.message)) {
    return { fieldErrors: { name: t("connections.duplicateName") } };
  }
  if (error.status === 422) return { message: t("common.checkFields"), fieldErrors: error.fieldErrors };
  return { message: error.message, fieldErrors: {} };
}

/** A one-line reason for a failed request (list load, row test, delete). */
export function errorMessage(t: Translator, error: unknown): string {
  return error instanceof ApiError ? error.message : t("common.genericError");
}
