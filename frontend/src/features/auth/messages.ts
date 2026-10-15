import { ApiError } from "@/lib/api";
import type { Translator } from "@/lib/i18n";

/** What the login page says about a failed attempt. Never reveals whether the email exists. */
export function loginErrorMessage(t: Translator, error: unknown): string {
  if (!(error instanceof ApiError)) return t("login.error.generic");
  switch (error.status) {
    case 401:
      return t("login.error.invalid");
    case 429:
      return error.retryAfterSeconds === undefined
        ? t("login.error.tooManyLater")
        : t("login.error.tooMany", {
            wait: t.plural("login.error.minutes", Math.max(1, Math.ceil(error.retryAfterSeconds / 60))),
          });
    case 0:
      return error.message;
    case 422:
      return t("common.checkFields");
    default:
      return t("login.error.generic");
  }
}
