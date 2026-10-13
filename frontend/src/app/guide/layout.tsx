import type { Metadata } from "next";
import { GuideHeader } from "@/features/guide/GuideHeader";

export const metadata: Metadata = {
  title: { default: "Duet guide", template: "%s · Duet guide" },
  description: "A visual, plain-language guide to Duet, the voice agent evaluator.",
};

/** The public user guide: no app shell and no session needed (see `features/auth/route-guard`). */
export default function GuideLayout({ children }: LayoutProps<"/guide">) {
  return (
    <div className="min-h-screen">
      <GuideHeader />
      {children}
    </div>
  );
}
