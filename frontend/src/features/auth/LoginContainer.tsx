"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { sanitizeNext } from "@/lib/navigation/next-param";
import { login } from "./api";
import { LoginForm } from "./LoginForm";
import { loginErrorMessage } from "./messages";
import { sessionQueryKey } from "./session";

export function LoginContainer() {
  const t = useT();
  const router = useRouter();
  const next = sanitizeNext(useSearchParams().get("next"));
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: login,
    onSuccess: ({ user }) => {
      queryClient.setQueryData(sessionQueryKey, user);
      router.replace(next);
    },
  });

  return (
    <LoginForm
      onSubmit={(values) => mutation.mutate(values)}
      pending={mutation.isPending || mutation.isSuccess}
      error={mutation.isError ? loginErrorMessage(t, mutation.error) : undefined}
      serverFieldErrors={mutation.error instanceof ApiError ? mutation.error.fieldErrors : undefined}
    />
  );
}
