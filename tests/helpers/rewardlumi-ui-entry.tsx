import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { VisitRewards } from "../../components/rewardlumi/visit-rewards";
import { RewardOwner, RewardWallet } from "../../components/rewardlumi/reward-workspaces";
import { GiftPosControl, GiftCustomerControl, type GiftCheckout } from "../../components/gift-card/pos-gift-card";
import type { RewardReply } from "../../types/rewardlumi";

const mode = location.pathname.slice(1) || "personal";
const fixture = await fetch("/fixture").then(r => r.json());
async function call(scope: string, op: string, args: Record<string, unknown> = {}) {
 const r = await fetch("/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, op, args }) });
 const d = await r.json(); if (!r.ok) throw Error(d.error); return d;
}
function App() {
 const [rewardRevision, setRewardRevision] = useState(0);
 const [paid, setPaid] = useState(false), [error, setError] = useState("");
 const gift = useRef<GiftCheckout>(() => Promise.resolve(null));
 const transport = useMemo(() => (op: string, args?: Record<string, unknown>): Promise<RewardReply> => call(mode === "owner" ? "owner" : mode === "pos" ? "pos" : mode === "display" ? "display" : "personal", op, args), []);
 const giftTransport = useMemo(() => (op: string, args?: Record<string, unknown>) => call(mode === "pos" ? "gift-pos" : "gift-display", op, args), []);
 async function checkout() { try { const g = await gift.current(); if (!g) await call("checkout", "submit"); setPaid(true); setError(""); } catch(e) {setError((e as Error).message);} }
 return <><header><b>Reylumi</b><span>Isolated QA · sample salon</span></header><nav>{["personal","display","pos","owner","wallet"].map(m=><a aria-current={m===mode?"page":undefined} key={m} href={'/'+m}>{m === "personal" ? "My check-in" : m === "display" ? "Customer screen" : m === "pos" ? "POS" : m === "owner" ? "Reward System" : "My Rewards"}</a>)}</nav>
 {mode === "owner" ? <RewardOwner transport={transport}/> : mode === "wallet" ? <RewardWallet transport={transport}/> : <main className={mode === "pos" ? "qa-pos" : "qa-personal"}>
 <section className="qa-visit"><span className="qa-badge">{paid ? "Paid" : "Checked in · #29"}</span><h1>Lumi Nail Studio</h1><p>Sophia Lee · Manicure</p><div className="qa-total"><span>Services</span><strong>$60.00</strong></div><p className="qa-note">{mode === "pos" ? "Scan or check-in already identified this customer." : "Your salon visit is connected. No extra scan needed."}</p></section>
 {!paid && <VisitRewards scope={mode === "pos" ? "pos" : mode === "display" ? "display" : "personal"} transport={transport} visitId={fixture.visitId} token="reward-qa-display" receipt={mode === "pos" ? fixture.receipt : undefined} onChange={v => setRewardRevision(v?.request?.revision ?? 0)}/>}
 {mode === "pos" ? <><GiftPosControl token="reward-qa-display" receipt={{...fixture.receipt,_rewardRevision:rewardRevision}} transport={giftTransport} onCheckout={fn => { gift.current = fn; }}/><section className="qa-visit"><h2>Checkout</h2><p>Reward eligibility and customer confirmation are checked by the server.</p><button onClick={()=>void checkout()} disabled={paid}>{paid ? "Payment complete" : "Collect payment & save ticket"}</button>{error && <p role="alert">{error}</p>}</section></> : <GiftCustomerControl token="reward-qa-display" transport={giftTransport}/>}
 <p className="qa-note">Actual Rewardlumi components · local isolated database · no real transactions</p>
 </main>}</>;
}
createRoot(document.getElementById("root")!).render(<App/>);
