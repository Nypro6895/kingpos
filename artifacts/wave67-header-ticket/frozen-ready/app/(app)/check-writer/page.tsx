import { CheckWriter } from "@/app/check-writer/check-writer";
import { withExperiencePage } from "@/components/experience-page";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { isOwnerMembership } from "@/lib/current-context";
import { getExperienceContext } from "@/lib/experience-context";
import { redirect } from "next/navigation";
export const metadata = {
  title: "Check Writer | Reylumi",
  robots: { index: false, follow: false },
};
async function CheckWriterPage() {
  const context = await requireSalonManagePageContext("/check-writer");
  if (!isOwnerMembership(context.currentMembership)) redirect("/payroll");
  return (
    <CheckWriter
      key={getExperienceContext(context).scope}
      expectedSalonId={context.currentSalon.id}
    />
  );
}
export default withExperiencePage(CheckWriterPage);
