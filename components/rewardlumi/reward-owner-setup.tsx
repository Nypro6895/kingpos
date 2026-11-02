"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useExperienceScope } from "@/components/experience-scope";
import { rewardTransport } from "@/lib/rewardlumi-client";
import { rewardEarnLines, rewardOfferLabel, rewardSpendExample } from "@/lib/reward-discovery";
import { defaultRewardProgram, rewardMoney, type RewardProgram, type RewardReadiness, type RewardReply, type RewardTransport, type RewardReport } from "@/types/rewardlumi";
import { RewardActivity } from "./reward-activity";
import { RewardOwnerPrompt } from "./reward-owner-prompt";
import styles from "./rewardlumi.module.css";

export function RewardOwnerSetup({transport}:{transport?:RewardTransport}) {
  const scope=useExperienceScope();
  return <OwnerSetup key={scope?.context.scope??"unscoped"} transport={transport}/>;
}
function OwnerSetup({transport}:{transport?:RewardTransport}) {
  const send=useMemo(()=>transport??rewardTransport("owner"),[transport]);
  const reportTransport=useMemo(()=>transport?async(day?:string)=>await send("report",{day}) as unknown as RewardReport:undefined,[transport,send]);
  const [program,setProgram]=useState<RewardProgram>(defaultRewardProgram),[stats,setStats]=useState<RewardReply>({});
  const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(false);
  const [preview,setPreview]=useState<{key:string;readiness?:RewardReadiness;error?:string}|null>(null);
  const load=useCallback(async()=>{
    const result=await send("load");setProgram(result.program??defaultRewardProgram);setStats(result);setLoaded(true);setError("");setSaved(false);
  },[send]);
  useEffect(()=>{let alive=true;send("load").then(result=>{if(alive){setProgram(result.program??defaultRewardProgram);setStats(result);setLoaded(true);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[send]);
  const activating=!(stats.program?.enabled&&stats.program?.nearby);
  const candidate=activating?{...program,enabled:true,nearby:true}:program;
  const previewKey=JSON.stringify(candidate);
  useEffect(()=>{
    if(!loaded)return;
    let alive=true;
    const timer=setTimeout(()=>{void send("preview",{program:JSON.parse(previewKey)}).then(result=>{if(alive)setPreview({key:previewKey,readiness:result.readiness});}).catch(e=>{if(alive)setPreview({key:previewKey,error:e.message});});},300);
    return()=>{alive=false;clearTimeout(timer);};
  },[send,loaded,previewKey]);
  const readiness=preview?.key===previewKey?preview.readiness:undefined;
  const previewError=preview?.key===previewKey?preview.error:undefined;
  function edit(patch:Partial<RewardProgram>){setProgram(p=>({...p,...patch}));setSaved(false);}
  async function save(activate:boolean){
    if(!loaded||busy||stats.version===undefined)return;
    setBusy(true);setError("");setSaved(false);
    try{const result=await send("save",{program:activate?{...program,enabled:true,nearby:true}:program,expectedVersion:stats.version});setProgram(result.program??program);setStats(result);setSaved(true);}
    catch(e){setError(e instanceof Error?e.message:"Could not save.");}finally{setBusy(false);}
  }
  const example=rewardSpendExample(program);
  const fields:["spendCents"|"spendPoints"|"welcomePoints"|"firstBookingPoints"|"visitPoints"|"conversionPoints",string][]=[
    ["spendCents","Complete spend threshold per receipt ($)"],["spendPoints","Points per complete threshold"],["welcomePoints","One-time welcome points"],
    ["firstBookingPoints","First completed, paid booking"],["visitPoints","Per completed, paid visit"],["conversionPoints","Paid booking from Before & After"],
  ];
  return <main className={styles.page} data-reward-owner><h1>Reward System</h1>
    <section className={styles.panel}><h2>{stats.readiness?.discoverable?"Visible in local reward discovery":stats.program?.enabled?"Earning enabled · discovery needs attention":"Not active"}</h2>
      <p className={styles.muted}>Choose the reward your salon provides. Review the customer preview, then activate once.</p>
      {!loaded&&!error&&<p role="status">Loading your settings…</p>}
      {error&&<p role="alert" className={styles.error}>{error}</p>}
      {error&&<button disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>Reload latest settings (replace this draft)</button>}
      {saved&&<p role="status" className={styles.status}>{stats.readiness?.discoverable?"Saved · visible in local reward discovery.":"Saved · not visible in local reward discovery."}</p>}
    </section>
    <section className={styles.panel}><h2>Customer preview</h2>
      {program.offers.map(offer=><p key={offer.id}><strong>{rewardOfferLabel(offer)}</strong>{offer.serviceId&&<small className={styles.muted}> · {stats.services?.find(s=>s.id===offer.serviceId)?.name??"Selected service"}</small>}</p>)}
      <p className={styles.muted}>Your salon funds these service discounts. Points stay with this salon.</p>
      <details><summary>How customers earn</summary><ul>{rewardEarnLines(program).map(line=><li key={line}>{line}.</li>)}</ul></details>
      {example&&<p className={styles.notice}>Spend-point example: one fully paid receipt with {rewardMoney(example.qualifyingSpendCents)} in qualifying services earns enough spend points for {rewardMoney(example.valueCents)} off. Splitting that spend across receipts can earn fewer points. Reward minimums and service restrictions apply.</p>}
      <div role="status">{previewError?<p className={styles.error}>{previewError}</p>:!readiness?<p className={styles.muted}>Checking whether customers can find and earn these rewards…</p>:readiness.discoverable?<p className={styles.status}>Ready for local discovery after you confirm.</p>:<ul className={styles.notice}>{readiness.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}</div>
      {readiness?.reasons.some(reason=>reason.includes("salon profile"))&&<Link href="/salon-profile">Review salon profile publication</Link>}
      <button className={styles.primary} disabled={!loaded||busy||stats.version===undefined||(activating&&!readiness?.discoverable)} onClick={()=>void save(activating)}>{busy?"Saving…":activating?"Activate local rewards":"Save changes"}</button>
      <p className={styles.muted}>This confirmation saves your earning rules and public offers. Existing confirmed rewards keep their selected terms.</p>
    </section>
    <section className={styles.panel}><details><summary><strong>Customize earning rules</strong></summary>{fields.map(([key,label])=><label key={key}><span>{label}</span><input aria-label={label} type="number" min={key==="spendCents"?0.01:0} step={key==="spendCents"?0.01:1} max={key==="spendCents"?1000:100000} value={key==="spendCents"?program[key]/100:program[key]} disabled={!loaded||busy} onChange={e=>edit({[key]:key==="spendCents"?Math.round(Number(e.target.value)*100):Number(e.target.value)})}/></label>)}
      <p className={styles.notice}>Only complete thresholds on each fully paid receipt earn spend points. The remainder does not carry forward. Pending referral points become available after the referred guest completes and fully pays for the visit. Posting alone earns no points.</p>
    </details></section>
    <section className={styles.panel}><details><summary><strong>Customize reward catalog · {program.offers.length}</strong></summary>{program.offers.map((offer,index)=><fieldset className={styles.offer} key={offer.id} disabled={!loaded||busy}><legend>Reward {index+1}</legend>
      <label>Title<input aria-label={`Reward ${index+1} title`} maxLength={100} value={offer.title} onChange={e=>edit({offers:program.offers.map((o,i)=>i===index?{...o,title:e.target.value}:o)})}/></label>
      {([['points','Points required'],['valueCents','Discount value ($)'],['minimumCents','Minimum services ($)']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={`Reward ${index+1} ${label}`} type="number" min={key==="minimumCents"?0:key==="points"?1:0.01} step={key==="points"?1:0.01} value={key==="points"?offer[key]:offer[key]/100} onChange={e=>edit({offers:program.offers.map((o,i)=>i===index?{...o,[key]:key==="points"?Number(e.target.value):Math.round(Number(e.target.value)*100)}:o)})}/></label>)}
      <label>Specific service<select value={offer.serviceId??""} onChange={e=>edit({offers:program.offers.map((o,i)=>i===index?{...o,serviceId:e.target.value||null}:o)})}><option value="">Any eligible services</option>{stats.services?.map(s=><option key={s.id} value={s.id}>{s.name}{s.active===false?" (inactive)":""}</option>)}</select></label>
      <button onClick={()=>edit({offers:program.offers.filter((_,i)=>i!==index)})}>Remove reward</button>
    </fieldset>)}<button disabled={!loaded||busy||program.offers.length>=20} onClick={()=>edit({offers:[...program.offers,{id:crypto.randomUUID(),title:"New reward",points:100,valueCents:500,minimumCents:4000}]})}>Add reward</button></details></section>
    <section className={styles.panel}><details><summary>Pause, hide discovery or save a draft</summary>
      <label>Enable new earning<input type="checkbox" checked={program.enabled} disabled={!loaded||busy} onChange={e=>edit({enabled:e.target.checked})}/></label>
      <label>Show rewards in Explore<input type="checkbox" checked={program.nearby} disabled={!loaded||busy} onChange={e=>edit({nearby:e.target.checked})}/></label>
      <p className={styles.muted}>Pausing earning or hiding discovery preserves existing balances and confirmed rewards.</p><button disabled={!loaded||busy||stats.version===undefined} onClick={()=>void save(false)}>Save these settings</button>
    </details></section>
    {stats.invitations&&stats.invitations.length>0&&<section className={styles.panel}><details><summary>Suggested promotion rules</summary>{stats.invitations.map(invite=><div key={invite.id}><p className={styles.muted}>Review these suggested rules. They only take effect after you confirm a save.</p><button disabled={!loaded||busy} onClick={()=>edit({...invite.template,enabled:program.enabled,nearby:program.nearby})}>Use suggested rules</button><button disabled={busy||invite.accepted} onClick={()=>{setBusy(true);void send("accept",{id:invite.id}).then(result=>setStats(old=>({...old,...result}))).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{invite.accepted?"Promotion joined":"Join promotion"}</button></div>)}</details></section>}
    {!transport&&<RewardOwnerPrompt setup key={stats.version}/>}
    <RewardActivity transport={reportTransport}/>
  </main>;
}
