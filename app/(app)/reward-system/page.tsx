import { withExperiencePage } from "@/components/experience-page";
import { marketPluginContext } from "@/lib/market-plugins";
import { RewardOwner } from "@/components/rewardlumi/reward-workspaces";
async function Page() {
  await marketPluginContext();
  return <RewardOwner />;
}

export default withExperiencePage(Page);
