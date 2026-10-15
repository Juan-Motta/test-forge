import { FaqEn } from "@/features/guide/content/en/faq";
import { FaqEs } from "@/features/guide/content/es/faq";
import { guideRoute } from "@/features/guide/route";

const route = guideRoute("faq", { en: FaqEn, es: FaqEs });

export const generateMetadata = route.generateMetadata;
export default route.Page;
