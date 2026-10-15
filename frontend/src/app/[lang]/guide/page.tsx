import { OverviewEn } from "@/features/guide/content/en/overview";
import { OverviewEs } from "@/features/guide/content/es/overview";
import { guideRoute } from "@/features/guide/route";

const route = guideRoute("overview", { en: OverviewEn, es: OverviewEs });

export const generateMetadata = route.generateMetadata;
export default route.Page;
