import type { GiftReply, GiftTransport } from "@/types/gift-card";
export function giftApi(scope: string, token?: string): GiftTransport {
  return async (op, args = {}) => {
    const response = await fetch("/api/gift-cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, token, op, args }), cache: "no-store", signal: AbortSignal.timeout(15000) });
    const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error || "Gift cards are unavailable."); return data as GiftReply;
  };
}
