import { withExperiencePage } from "@/components/experience-page";
import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { RewardWallet } from "@/components/rewardlumi/reward-workspaces";
async function Page() {
  const context = await getCurrentBusinessContext();
  if (!context.user) redirect("/login");
  return <RewardWallet key={context.user.id} />;
}

export default withExperiencePage(Page);
