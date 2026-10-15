"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Alert, Button, Field, Input, PasswordInput } from "@/ui";
import type { FieldErrors } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { loginSchema, type LoginValues } from "./login-schema";

type LoginFormProps = {
  onSubmit: (values: LoginValues) => void;
  pending: boolean;
  /** Form-level error from the last attempt. */
  error?: string;
  /** Per-field errors from the server (422), keyed by field name. */
  serverFieldErrors?: FieldErrors;
};

/** Presentational: validates locally and reports values; knows nothing about the API. */
export function LoginForm({ onSubmit, pending, error, serverFieldErrors = {} }: LoginFormProps) {
  const t = useT();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema(t)),
    defaultValues: { email: "", password: "" },
  });

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <Field label={t("login.email")} error={errors.email?.message ?? serverFieldErrors.email}>
        {(control) => (
          <Input type="email" autoComplete="username" spellCheck={false} {...control} {...register("email")} />
        )}
      </Field>
      <Field label={t("login.password")} error={errors.password?.message ?? serverFieldErrors.password}>
        {(control) => <PasswordInput autoComplete="current-password" {...control} {...register("password")} />}
      </Field>
      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit" loading={pending} className="w-full">
        {pending ? t("login.signingIn") : t("login.signIn")}
      </Button>
    </form>
  );
}
