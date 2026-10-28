import "server-only";
import {getReusableReadValidationToken,memoizeReadValidation} from "./read-context-scope";
type RpcError={code?:unknown;details?:unknown;hint?:unknown;message?:unknown};
type RpcResult={data:unknown;error:RpcError|null};
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<RpcResult>;
type Snapshot={version:1;salonIds:string[];serviceIds:string[];responses:Record<string,{data:Record<string,unknown>[]|null;error:RpcError|null}>};
const keys=new WeakMap<Rpc,symbol>();
const names=new Set(["get_public_explore_decision_signals","get_public_lumi_trust_signals","get_public_salon_identity","get_public_explore_reputation_summaries","get_public_salon_operating_status_inputs","get_public_salon_service_prices"]);
/** Fresh public display facts only. Same runner and read request may share the
 * batch; private identity, admission and final revocation probes cannot use it. */
export async function publicExploreCardRpc(rpc:Rpc,ids:string[]):Promise<Rpc>{
 if(!getReusableReadValidationToken()||!ids.length||ids.length>100)return rpc;
 let key=keys.get(rpc);if(!key){key=Symbol("public-explore-card");keys.set(rpc,key);}
 const sorted=[...new Set(ids)].sort();
 const batch=await memoizeReadValidation(key,JSON.stringify(sorted),()=>rpc("get_public_explore_card_metadata_v1",{target_salon_ids:sorted}));
 const error=batch.error as {code?:string}|null;
 if(error&&["PGRST202","42883"].includes(error.code??""))return rpc;
 if(error)return async(name,args)=>names.has(name)?{data:null,error}:rpc(name,args);
 const value=batch.data as Snapshot;
 if(value?.version!==1||!Array.isArray(value.salonIds)||JSON.stringify([...value.salonIds].sort())!==JSON.stringify(sorted)||!Array.isArray(value.serviceIds)||!value.responses)throw Error("Public metadata snapshot unavailable.");
 return async(name,args)=>{
  const entry=value.responses[name],prices=name==="get_public_salon_service_prices",field=prices?"service_id":"salon_id",allowed=prices?value.serviceIds:value.salonIds;
  const requested=args[prices?"target_service_ids":"target_salon_ids"];
  if(names.has(name)&&entry&&Array.isArray(requested)&&requested.every(id=>typeof id==="string"&&allowed.includes(id))){
   if(entry.error)return{data:null,error:entry.error};
   if(!Array.isArray(entry.data))throw Error("Public metadata response unavailable.");
   return{data:entry.data.filter(row=>requested.includes(row[field])),error:null};
  }
  return rpc(name,args);
 };
}
