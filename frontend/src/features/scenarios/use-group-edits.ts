"use client";

import { ApiError, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useUpdateGroup } from "./queries";
import type { GroupChanges } from "./types";

/**
 * Saves one part of a group (its title, description or tags) as it is edited in place; each
 * resolves with why the change was refused (a taken title, an error), or nothing once saved.
 */
export function useGroupEdits(groupId: string) {
  const t = useT();
  const update = useUpdateGroup();
  async function save(changes: GroupChanges): Promise<string | undefined> {
    try {
      await update.mutateAsync({ id: groupId, changes });
      return undefined;
    } catch (error) {
      return error instanceof ApiError && error.status === 409 ? t("groups.error.taken") : errorMessage(error);
    }
  }
  return {
    rename: (name: string) => (name ? save({ name }) : t("groups.error.title")),
    describe: (description: string) => save({ description }),
    retag: (tags: string[]) => save({ tags }),
  };
}
