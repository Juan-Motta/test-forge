"use client";

import { ApiError, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useUpdateApi } from "./queries";
import type { ApiChanges } from "./types";

/**
 * Saves one part of an API (its name, description or tags) as it is edited in place; each
 * resolves with why the change was refused (a taken name, an error), or nothing once saved.
 */
export function useApiEdits(apiId: string) {
  const t = useT();
  const update = useUpdateApi();
  async function save(changes: ApiChanges): Promise<string | undefined> {
    try {
      await update.mutateAsync({ id: apiId, changes });
      return undefined;
    } catch (error) {
      return error instanceof ApiError && error.status === 409 ? t("apis.error.taken") : errorMessage(error);
    }
  }
  return {
    rename: (name: string) => (name ? save({ name }) : t("apis.error.name")),
    describe: (description: string) => save({ description }),
    retag: (tags: string[]) => save({ tags }),
  };
}
