import { randomUUID } from "node:crypto";
import type { advertisingClient } from "@/lib/explore-advertising";

type Client = ReturnType<typeof advertisingClient>;
type Phase = "topup" | "fund" | "renew" | "close" | "pause_reminders";
type Claim = {item_id:string;lease_token:string};
export type CampaignQueueResult = {
  ok:boolean;
  complete:boolean;
  status:"complete"|"deferred"|"partial";
  deferred:Phase[];
  attempted:Record<Phase,number>;
  errors:{phase:Phase;operation:string;itemId?:string}[];
};

// Separate budgets reserve time for settlement even when a payment provider or
// readiness check is unavailable. One item is claimed at a time; an interrupted
// worker's lease expires, while the durable attempt order advances past poison rows.
const phaseEnds:Record<Phase,number>={topup:60000,fund:105000,renew:140000,close:210000,pause_reminders:240000};
const phases:Phase[]=["topup","fund","renew","close","pause_reminders"];
export async function runCampaignCreditQueue({client,paymentReady,topUp,now=Date.now}:{
  client:Client;paymentReady:()=>Promise<boolean>;topUp:(salonId:string,deadline:number)=>Promise<void>;now?:()=>number;
}):Promise<CampaignQueueResult>{
  const result:CampaignQueueResult={ok:true,complete:false,status:"partial",deferred:[],attempted:{topup:0,fund:0,renew:0,close:0,pause_reminders:0},errors:[]};
  const run=randomUUID();
  const started=now();
  const record=(phase:Phase,operation:string,itemId?:string)=>{result.ok=false;result.errors.push({phase,operation,...(itemId?{itemId}:{})});};
  const signal=(deadline:number)=>{
    const remaining=deadline-now();
    if(remaining<=0)throw new Error("Campaign queue deadline reached");
    return AbortSignal.timeout(Math.min(10000,remaining));
  };
  const rpc=async(name:string,args:Record<string,unknown>,deadline:number)=>{
    const abort=signal(deadline);
    const response=await client.rpc(name,args).abortSignal(abort);
    if(response.error)throw new Error(name);
    return response.data;
  };
  for(const phase of phases){
    const deadline=started+phaseEnds[phase];
    if(phase==="topup"){
      try {
        // Bound the read, without starting a payment if readiness times out.
        const ready=await readinessWithin(paymentReady,10000);
        if(!ready)continue;
      }catch{record(phase,"payment_readiness");continue;}
    }
    let exhausted=false;
    for(let index=0;index<100 && now()<deadline;index++){
      let claims:Claim[];
      let pending=false;
      try{const response=await rpc("campaign_credit_queue_claim",{p_phase:phase,p_run:run,p_limit:1,p_seed:index===0},deadline);
        claims=response?.items;pending=response?.pending===true;
        if(!Array.isArray(claims)||claims.length>1||claims.some(row=>typeof row.item_id!=="string"||typeof row.lease_token!=="string"))throw new Error("Invalid queue response");
      }catch{record(phase,"claim");break;}
      if(!claims.length){exhausted=!pending;break;}
      const claim=claims[0];
      result.attempted[phase]++;
      try{
        if(phase==="topup")await topUp(claim.item_id,deadline);
        else if(phase==="fund"){
          // Re-read eligibility after claiming: owners can change a campaign or
          // payment choice while the queue is running. The RPC rechecks under lock.
          const {data:campaign,error}=await client.from("owner_campaigns").select("id,salon_id,owner_id,keep_running,status,auto_fund").eq("id",claim.item_id).abortSignal(signal(deadline)).maybeSingle();
          if(error)throw new Error("campaign_read");
          if(campaign?.status==="awaiting_payment"&&campaign.auto_fund){
            const {data:wallet,error:walletError}=await client.from("campaign_wallets").select("auto_topup_enabled,payment_blocked").eq("salon_id",campaign.salon_id).abortSignal(signal(deadline)).single();
            if(walletError)throw new Error("wallet_read");
            if(wallet?.auto_topup_enabled&&!wallet.payment_blocked)await rpc("campaign_credit_fund",{p_id:campaign.id,p_salon:campaign.salon_id,p_owner:campaign.owner_id,p_keep:campaign.keep_running},deadline);
          }
        }else if(phase==="renew")await rpc("campaign_credit_renew",{p_id:claim.item_id},deadline);
        else if(phase==="close")await rpc("campaign_credit_close_expired",{p_salon:claim.item_id},deadline);
        else await rpc("campaign_pause_reminder",{p_id:claim.item_id},deadline);
      }catch{record(phase,"process",claim.item_id);}
      finally{
        try{if(!await rpc("campaign_credit_queue_finish",{p_phase:phase,p_item:claim.item_id,p_token:claim.lease_token},deadline))record(phase,"lease_lost",claim.item_id);}
        catch{record(phase,"finish",claim.item_id);}
      }
    }
    if(!exhausted)result.deferred.push(phase);
  }
  result.complete=result.ok&&result.deferred.length===0;
  result.status=!result.ok?"partial":result.complete?"complete":"deferred";
  return result;
}

async function readinessWithin(load:()=>Promise<boolean>,milliseconds:number){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([load(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Payment readiness timed out")),milliseconds);})]);}
  finally{if(timer)clearTimeout(timer);}
}
