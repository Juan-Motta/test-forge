import { GettingStartedEn } from "@/features/guide/content/en/getting-started";
import { GettingStartedEs } from "@/features/guide/content/es/getting-started";
import { guideRoute } from "@/features/guide/route";

const route = guideRoute("getting-started", { en: GettingStartedEn, es: GettingStartedEs });

export const generateMetadata = route.generateMetadata;
export default route.Page;
