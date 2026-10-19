import type { Metadata } from "next";
import { Suspense } from "react";
import { GroupContainer } from "@/features/scenarios/GroupContainer";
import { T } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { Spinner } from "@/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("groups.one") };
}

// With Cache Components the id is runtime data: read it inside a Suspense boundary.
export default function Page({ params }: PageProps<"/[lang]/scenarios/groups/[id]">) {
  return (
    <Suspense fallback={<Spinner label={<T k="groups.loadingOne" />} />}>
      {params.then(({ id }) => (
        <GroupContainer key={id} groupId={id} />
      ))}
    </Suspense>
  );
}
