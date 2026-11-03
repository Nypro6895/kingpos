import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RewardWallet } from "../../components/rewardlumi/reward-workspaces";
import { AppLocalRewardWallet } from "../../lib/app-local-reward-wallet";
import type { RewardReply } from "../../types/rewardlumi";
const pending: { resolve(value: RewardReply): void }[] = [];
const fixture = { pending, calls: 0, switchActor: (actor: string) => { void actor; }, resolve: (index: number, cards: RewardReply["cards"]) => pending[index].resolve({ cards }) };
Object.assign(window, { walletAnchorQA: fixture, fixtureRewardTransport: async () => { fixture.calls++; return new Promise<RewardReply>(resolve => pending.push({ resolve })); } });
function App() {
  const [actor, setActor] = useState("account-a");
  useEffect(() => { fixture.switchActor = setActor; }, []);
  return (window as Window & { nativeWalletFixture?: boolean }).nativeWalletFixture
    ? <AppLocalRewardWallet viewerId={actor} path={location.pathname + location.hash}/>
    : <RewardWallet viewerId={actor}/>;
}
createRoot(document.getElementById("root")!).render(<App/>);
