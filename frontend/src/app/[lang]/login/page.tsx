import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoginContainer } from "@/features/auth/LoginContainer";
import { Brand } from "@/features/shell/Brand";
import { LanguageControl } from "@/features/shell/LanguageControl";
import { ThemeControl } from "@/features/theme/ThemeControl";
import { T } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { Spinner } from "@/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("login.metaTitle") };
}

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
              <T k="login.title" />
            </h1>
            <p className="text-sm text-muted">
              <T k="login.subtitle" />
            </p>
          </div>
          {/* The form reads `?next=`, which is only known at request time. */}
          <Suspense fallback={<Spinner label={<T k="ui.loading" />} />}>
            <LoginContainer />
          </Suspense>
        </section>
        <p className="text-center text-sm text-muted">
          <Link href="/guide" className="underline-offset-4 hover:underline">
            <T k="login.guideLink" />
          </Link>
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ThemeControl />
          <LanguageControl />
        </div>
      </div>
    </main>
  );
}
