import type { RewardReply, RewardTransport } from "@/types/rewardlumi";
export function rewardTransport(scope: "owner" | "personal" | "pos" | "display", token?: string): RewardTransport {
  return async (op, args = {}) => {
    const response = await fetch("/api/rewards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, token, op, args }), cache: "no-store", signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Rewards are unavailable. Retry when connected.");
    return data as RewardReply;
  };
}
