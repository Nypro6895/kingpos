import { withExperiencePage } from "@/components/experience-page";
import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { RewardWallet } from "@/components/rewardlumi/reward-workspaces";
async function Page({searchParams}: {searchParams: Promise<{from?: string}>}) {
  const {from} = await searchParams;
  const context = await getCurrentBusinessContext();
  if (!context.user) redirect("/login");
  return <RewardWallet key={context.user.id} viewerId={context.user.id} backHref={from === "beauty" ? "/beauty" : "/more"} />;
}

export default withExperiencePage(Page);
