import { ScoringEn } from "@/features/guide/content/en/scoring";
import { ScoringEs } from "@/features/guide/content/es/scoring";
import { guideRoute } from "@/features/guide/route";

const route = guideRoute("scoring", { en: ScoringEn, es: ScoringEs });

export const generateMetadata = route.generateMetadata;
export default route.Page;
