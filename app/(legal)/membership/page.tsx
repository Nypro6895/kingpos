import type { Metadata } from "next";
import { Suspense } from "react";
import { withExperiencePage } from "@/components/experience-page";
import { publicMembershipPlans, publicMembershipWebsite } from "@/lib/platform-admin/membership";
import { MembershipWebsite, MembershipWebsiteFrame, MembershipWebsiteLoading } from "./website";
export const metadata: Metadata = { title: "Reylumi Membership | More tools. More possibilities.", description: "Explore Reylumi membership for your salon: all Reylumi plugins, service allowances and technical support in one plan." };
async function MembershipContent() {
  const [plans, copy] = await Promise.all([publicMembershipPlans(), publicMembershipWebsite()]);
  return <MembershipWebsite plans={plans} copy={copy ?? undefined} framed={false} />;
}
function MembershipWebsitePage() {
  return <MembershipWebsiteFrame><Suspense fallback={<MembershipWebsiteLoading />}><MembershipContent /></Suspense></MembershipWebsiteFrame>;
}
export default withExperiencePage(MembershipWebsitePage);
