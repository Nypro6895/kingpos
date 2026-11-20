import {MarketTargetAccessNotice} from "./market-target-access-notice";
import "server-only";
import type { ReactNode } from "react";
import { resolveMarketTarget } from "@/lib/market-target-context";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { runInBusinessContext } from "@/lib/scoped-business-context";
import { MarketTargetProvider } from "@/app/market/scoped-market-client";
/** Scope a settings destination and its action closures without switching the user's workspace. */
export function withOwnedSalonPage<P extends {searchParams: Promise<{salon?:string}>}>(Page:(props:P)=>Promise<ReactNode>){
 return async function OwnedSalonPage(props:P){
  const query=await props.searchParams;
  const context=query.salon!==undefined?await resolveMarketTarget(query.salon).catch(()=>null):await getCurrentBusinessContext();
  if(!context)return <MarketTargetAccessNotice/>;
  const content=await runInBusinessContext(context,()=>Page(props));
  return <MarketTargetProvider key={context.currentSalon?.id} salonId={context.currentSalon?.id}>{content}</MarketTargetProvider>;
 };
}
