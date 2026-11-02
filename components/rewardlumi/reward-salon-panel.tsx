"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {rewardEarnLines,rewardOfferLabel,type RewardPublicProgram} from "@/lib/reward-discovery";
import {rewardInvitation,rewardLocalLabel,rewardVisitTarget} from "@/lib/reward-invitation";
import styles from "./reward-discovery.module.css";
type Program=RewardPublicProgram;
export function RewardSalonPanel({salonId,canBook}:{salonId:string;canBook:boolean}){
 const [reply,setReply]=useState<{id:string;data:Program}|null>(null);
 useEffect(()=>{const controller=new AbortController();fetch(`/api/rewards/program?salonId=${encodeURIComponent(salonId)}`,{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])}).then(async response=>{if(!response.ok)return;const data:Program=await response.json();if(!controller.signal.aborted)setReply({id:salonId,data});}).catch(()=>{});return()=>controller.abort();},[salonId]);
 const data=reply?.id===salonId?reply.data:null;
 if(!data?.salon)return <div id="salon-rewards"/>;
 const salon={...data.salon,canBook:canBook&&data.salon.canBook===true},invitation=rewardInvitation(salon,"all",data.earningEligibility),target=rewardVisitTarget(salon,"all",data.earningEligibility);
 return <section id="salon-rewards" className={styles.group} aria-label="Salon rewards"><h2>Rewards at {salon.name}</h2>
  <p className={styles.localContext}>{rewardLocalLabel(salon)}</p><p><strong>{invitation.title}</strong></p><p>{invitation.body}</p>
  <div className={styles.controls}>{target.startsWith("/book/")&&<Link className={styles.primary} href={target} prefetch={false}>Book a visit</Link>}{data.joined&&<Link href="/rewards">My rewards</Link>}{data.authenticated&&<Link href="/qr">Open personal check-in code</Link>}{!data.authenticated&&<><Link href={`/signup?next=${encodeURIComponent(target)}`}>Create an account</Link><Link href={`/login?next=${encodeURIComponent(target)}`}>Sign in</Link></>}</div>
  <details><summary>How to earn & reward conditions</summary>{data.joined&&<p>{data.available} available points here. Use your linked account during your visit.</p>}<ul>{rewardEarnLines(salon).map(line=><li key={line}>{line}.</li>)}</ul>{salon.offers.map(o=><p key={o.id}>{rewardOfferLabel(o)}{o.serviceName?` · ${o.serviceName}`:""}</p>)}<p>Points stay with this salon. Your available balance and eligibility are checked at your visit.</p></details>
 </section>;
}
