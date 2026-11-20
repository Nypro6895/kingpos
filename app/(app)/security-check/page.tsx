import { withExperiencePage } from "@/components/experience-page";
import { SecurityCheck } from "./security-check";

export const metadata = { title: "Security check | Reylumi" };
function SecurityCheckPage() {
  return <main className="mx-auto max-w-md px-5 py-12"><h1 className="text-2xl font-semibold">Security check</h1><p className="mt-3 text-sm text-zinc-600">Complete this check, then return to the action you were taking. Verification lasts 15 minutes.</p><SecurityCheck /></main>;
}

export default withExperiencePage(SecurityCheckPage);
