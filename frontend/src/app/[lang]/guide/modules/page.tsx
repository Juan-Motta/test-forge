import { ModulesEn } from "@/features/guide/content/en/modules";
import { ModulesEs } from "@/features/guide/content/es/modules";
import { guideRoute } from "@/features/guide/route";

const route = guideRoute("modules", { en: ModulesEn, es: ModulesEs });

export const generateMetadata = route.generateMetadata;
export default route.Page;
