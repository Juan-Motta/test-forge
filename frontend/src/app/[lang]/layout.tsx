import type { Metadata } from "next";
import { JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";
import { notFound } from "next/navigation";
import { lang } from "next/root-params";
import { THEME_INIT_SCRIPT } from "@/lib/browser/theme-init";
import { LOCALES, isLocale } from "@/lib/i18n";
import { RoutedI18nProvider } from "@/lib/i18n/RoutedI18nProvider";
import { Providers } from "../providers";
import "../globals.css";

const sans = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: { default: "TestForge", template: "%s · TestForge" },
  description: "Agent and API testing",
};

/** Every page is prerendered once per language; the proxy picks one without changing the URL. */
export async function generateStaticParams() {
  return LOCALES.map((locale) => ({ lang: locale }));
}

export default async function RootLayout({ children }: LayoutProps<"/[lang]">) {
  const locale = await lang();
  if (!isLocale(locale)) notFound();
  return (
    // The inline script sets data-theme before hydration; React keeps what it finds on <html>.
    <html lang={locale} className={`${sans.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-ground text-fg">
        <RoutedI18nProvider locale={locale}>
          <Providers>{children}</Providers>
        </RoutedI18nProvider>
      </body>
    </html>
  );
}
