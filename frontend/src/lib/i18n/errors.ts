import { ApiError, type FormErrorView } from "@/lib/api";
import type { Translator } from "./translate";

/**
 * A form's failed-save view with the client's own words in the page language: the generic
 * failure and the 422 "check the fields" line. Messages from the API (and field errors) stay as
 * the server wrote them.
 */
export function localizeFormError(t: Translator, error: unknown, view: FormErrorView): FormErrorView {
  if (!(error instanceof ApiError)) return { ...view, message: t("common.genericError") };
  if (error.status === 422) return { ...view, message: t("common.checkFields") };
  return view;
}

/** A one-line reason for a failed request: the API's message, or the generic failure in the page language. */
export function localErrorMessage(t: Translator, error: unknown): string {
  return error instanceof ApiError ? error.message : t("common.genericError");
}
