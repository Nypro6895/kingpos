"use client";

import { RewardWallet } from "@/components/rewardlumi/reward-workspaces";

/** Keep the original wallet/POST transport; reveal only an already returned card. */
export function AppLocalRewardWallet({ path, viewerId }: { path: string; viewerId?: string }) {
  return <RewardWallet viewerId={viewerId} anchorPath={path} backHref={new URL(path,"https://reylumi.com").searchParams.get("from")==="beauty"?"/beauty":"/more"}/>;
}
