import type { Metadata } from "next";
import { GuideHeader } from "@/features/guide/GuideHeader";
import { fill, guideText } from "@/features/guide/text";
import { getLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = guideText(await getLocale());
  return {
    title: { default: meta.layoutTitle, template: fill(meta.title, { title: "%s" }) },
    description: meta.layoutDescription,
  };
}

/** The public user guide: no app shell and no session needed (see `features/auth/route-guard`). */
export default function GuideLayout({ children }: LayoutProps<"/[lang]/guide">) {
  return (
    <div className="min-h-screen">
      <GuideHeader />
      {children}
    </div>
  );
}
