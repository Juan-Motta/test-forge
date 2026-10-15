import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoginContainer } from "@/features/auth/LoginContainer";
import { Brand } from "@/features/shell/Brand";
import { ThemeControl } from "@/features/theme/ThemeControl";
import { Spinner } from "@/ui";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <Brand />
        <section
          aria-labelledby="login-heading"
          className="flex flex-col gap-6 rounded-xl border border-line bg-panel p-6"
        >
          <div className="flex flex-col gap-1.5">
            <h1 id="login-heading" className="text-xl font-semibold tracking-[-0.01em]">
              Sign in to Duet
            </h1>
            <p className="text-sm text-muted">Use the account your administrator created for you.</p>
          </div>
          {/* The form reads `?next=`, which is only known at request time. */}
          <Suspense fallback={<Spinner label="Loading" />}>
            <LoginContainer />
          </Suspense>
        </section>
        <p className="text-center text-sm text-muted">
          <Link href="/guide" className="underline-offset-4 hover:underline">
            New here? Read the guide
          </Link>
        </p>
        <ThemeControl className="self-center" />
      </div>
    </main>
  );
}
