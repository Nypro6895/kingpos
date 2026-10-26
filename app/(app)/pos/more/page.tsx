import { withExperiencePage } from "@/components/experience-page";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { OwnerPosMore } from "@/app/pos/owner-pos-more";

async function PosMorePage() {
  await requireSalonManagePageContext("/pos/more");
  return <OwnerPosMore />;
}

export default withExperiencePage(PosMorePage);
