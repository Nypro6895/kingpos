import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BeautyRewardSummary } from "../../app/beauty/beauty-reward-summary";
import { RewardWallet } from "../../components/rewardlumi/reward-workspaces";
import type { RewardReply, RewardTransport } from "../../types/rewardlumi";

type Pending = { actor: string; resolve: (reply: RewardReply) => void; reject: (error: Error) => void };
const pending: Pending[] = [];
let switchActor: (actor: string) => void;
const api = {
  pending,
  calls: 0,
  switchActor: (actor: string) => switchActor(actor),
  resolve: (index: number, data: RewardReply) => pending[index].resolve(data),
  reject: (index: number) => pending[index].reject(new Error("Fixture network error")),
};
Object.assign(window, { walletQA: api });

function App() {
  const [actor, setActor] = useState("customer-a");
  useEffect(() => { switchActor = setActor; }, []);
  const transport = useMemo<RewardTransport>(() => async () => {
    api.calls++;
    return new Promise<RewardReply>((resolve, reject) => pending.push({ actor, resolve, reject }));
  }, [actor]);
  return location.pathname === "/beauty" ? <div className="beauty-home"><BeautyRewardSummary viewerId={actor === "guest" ? null : actor} transport={transport}/></div> : <RewardWallet viewerId={actor} transport={transport}/>;
}
createRoot(document.getElementById("root")!).render(<App/>);
