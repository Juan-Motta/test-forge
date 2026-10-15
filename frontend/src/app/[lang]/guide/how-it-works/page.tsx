import { HowItWorksEn } from "@/features/guide/content/en/how-it-works";
import { HowItWorksEs } from "@/features/guide/content/es/how-it-works";
import { guideRoute } from "@/features/guide/route";

const route = guideRoute("how-it-works", { en: HowItWorksEn, es: HowItWorksEs });

export const generateMetadata = route.generateMetadata;
export default route.Page;
