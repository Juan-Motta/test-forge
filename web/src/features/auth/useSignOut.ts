"use client";

import { useMutation } from "@tanstack/react-query";
import { replaceLocation } from "@/lib/navigation/redirect";
import { logout } from "./api";

/**
 * Signs out on the backend, then reloads into the login page. A full load (not a client
 * navigation) discards every cached query, and clearing the cache in place would make mounted
 * queries refetch with the now-revoked session.
 */
export function useSignOut() {
  return useMutation({
    mutationFn: logout,
    onSuccess: () => replaceLocation("/login"),
  });
}
