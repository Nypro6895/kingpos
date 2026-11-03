import type { Metadata } from "next";
import { withExperiencePage } from "@/components/experience-page";
import { publicMembershipPlans, publicMembershipWebsite } from "@/lib/platform-admin/membership";
import { MembershipWebsite } from "./website";
export const metadata: Metadata = { title: "Reylumi Membership | More tools. More possibilities.", description: "Explore Reylumi membership for your salon: all Reylumi plugins, service allowances and technical support in one plan." };
async function MembershipWebsitePage() { const [plans,copy]=await Promise.all([publicMembershipPlans(),publicMembershipWebsite()]);return <MembershipWebsite plans={plans} copy={copy??undefined} />; }
export default withExperiencePage(MembershipWebsitePage);
