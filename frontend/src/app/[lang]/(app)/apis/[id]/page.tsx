import type { Metadata } from "next";
import { Suspense } from "react";
import { ApiContainer } from "@/features/apiflows/ApiContainer";
import { T } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { Spinner } from "@/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("apis.one") };
}

// With Cache Components the id is runtime data: read it inside a Suspense boundary.
export default function Page({ params }: PageProps<"/[lang]/apis/[id]">) {
  return (
    <Suspense fallback={<Spinner label={<T k="apis.loadingOne" />} />}>
      {params.then(({ id }) => (
        <ApiContainer key={id} apiId={id} />
      ))}
    </Suspense>
  );
}
