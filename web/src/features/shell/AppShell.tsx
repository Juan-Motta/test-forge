"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useSession } from "@/features/auth/session";
import { useSignOut } from "@/features/auth/useSignOut";
import { CloseIcon, IconButton, MenuIcon, cn } from "@/ui";
import { Brand } from "./Brand";
import { Sidebar } from "./Sidebar";

const ENVIRONMENT_LABEL = process.env.NEXT_PUBLIC_ENVIRONMENT_LABEL || "local";
const SIDEBAR_ID = "app-sidebar";

/** Container: wires session, sign-out and the mobile drawer around the presentational sidebar. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const session = useSession();
  const signOut = useSignOut();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line-soft bg-sidebar px-4 py-2 md:hidden">
        <Brand />
        <IconButton
          label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          aria-controls={SIDEBAR_ID}
          icon={menuOpen ? <CloseIcon /> : <MenuIcon />}
          onClick={() => setMenuOpen((open) => !open)}
        />
      </header>
      <Sidebar
        id={SIDEBAR_ID}
        pathname={pathname}
        environmentLabel={ENVIRONMENT_LABEL}
        user={session.data}
        onSignOut={() => signOut.mutate()}
        signingOut={signOut.isPending || signOut.isSuccess}
        signOutError={signOut.isError ? "Could not sign out. Try again." : undefined}
        accountUnavailable={session.isError}
        onNavigate={() => setMenuOpen(false)}
        className={cn(
          "border-line-soft md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:border-r",
          menuOpen ? "flex border-b" : "hidden",
        )}
      />
      <main className="flex min-w-0 flex-1 flex-col gap-6 px-4 pt-6 pb-12 md:px-9 md:pt-7">{children}</main>
    </div>
  );
}
