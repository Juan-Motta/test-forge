import { InterruptionsEn } from "@/features/guide/content/en/interruptions-and-evaluator";
import { InterruptionsEs } from "@/features/guide/content/es/interruptions-and-evaluator";
import { guideRoute } from "@/features/guide/route";

const route = guideRoute("interruptions-and-evaluator", { en: InterruptionsEn, es: InterruptionsEs });

export const generateMetadata = route.generateMetadata;
export default route.Page;
