"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VisitRewards } from "./visit-rewards";
import { rewardTransport } from "@/lib/rewardlumi-client";
import { GiftPosControl, type GiftCheckout } from "@/components/gift-card/pos-gift-card";
import type { RewardReply, RewardView } from "@/types/rewardlumi";
import { giftApi } from "@/components/gift-card/gift-api";
import type { GiftSession } from "@/types/gift-card";
export function OwnerCartBenefits({ cartId, receipt, onView, onCheckout, onGift, onDelivery }: { cartId: string; receipt: Record<string, unknown>; onView: (v: RewardView | null) => void; onCheckout: (fn: GiftCheckout) => void; onGift?: (session: GiftSession | null) => void; onDelivery?: (session: GiftSession) => void }) {
  const api = useMemo(() => rewardTransport("pos"), []);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; onGift?.(null); }; }, [onGift]);
  const giftBase = useMemo(() => giftApi("pos"), []);
  const giftTransport = useMemo(() => async (op: string, args?: Record<string, unknown>) => {
    const result = await giftBase(op, args); if (active.current && result.session) onGift?.(result.session); return result;
  }, [giftBase, onGift]);
  const [token, setToken] = useState<string>();
  const [revision, setRevision] = useState(0);
  const transport = useMemo(() => async (op: string, args?: Record<string, unknown>) => {
    if (op !== "quote") return api(op, args);
    const reply = await api("owner-cart", { cartId, receipt: args?.receipt }) as RewardReply & { token?: string };
    if (reply.token) setToken(reply.token); return reply;
  }, [api, cartId]);
  const changed = useCallback((view: RewardView | null) => { onView(view); setRevision(view?.request?.revision ?? 0); }, [onView]);
  // A quote is an output of this panel, not an input to the next quote request.
  // Feeding it back resets the view whenever the parent receives that quote.
  const quoteReceipt = { ...receipt, rewardQuote: undefined };
  return <div data-owner-benefits><VisitRewards scope="pos" receipt={quoteReceipt} transport={transport} onChange={changed} />{token && <><GiftPosControl token={token} receipt={{ ...receipt, _rewardRevision: revision }} transport={giftTransport} onCheckout={onCheckout} onDelivery={onDelivery} /><a href={`/pos/customer-display?token=${encodeURIComponent(token)}`} target="_blank" rel="noopener noreferrer">Open customer screen</a></>}</div>;
}
