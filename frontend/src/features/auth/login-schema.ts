import { z } from "zod";
import type { Translator } from "@/lib/i18n";

// Limits mirror the backend's LoginRequest so the form never sends what the API would reject.
export const loginSchema = (t: Translator) =>
  z.object({
    email: z
      .string()
      .trim()
      .min(1, t("login.error.email"))
      .max(320, t("common.maxChars", { max: 320 }))
      .regex(/^[^\s@]+@[^\s@]+$/, t("login.error.emailInvalid")),
    password: z
      .string()
      .min(1, t("login.error.password"))
      .max(1024, t("common.maxChars", { max: 1024 })),
  });

export type LoginValues = z.infer<ReturnType<typeof loginSchema>>;
