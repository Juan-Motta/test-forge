import { AutomationEn } from "@/features/guide/content/en/automation";
import { AutomationEs } from "@/features/guide/content/es/automation";
import { guideRoute } from "@/features/guide/route";

const route = guideRoute("automation", { en: AutomationEn, es: AutomationEs });

export const generateMetadata = route.generateMetadata;
export default route.Page;
