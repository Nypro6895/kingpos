"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { PayrollLiveChange } from "@/types/payroll-live-history";
import { PayrollChangeHistory } from "@/app/payroll/payroll-change-history";
import { WorkspaceText } from "@/components/workspace-language";

export function DailyReportChangeHistory({salonId,reportDate,savedAt}:{salonId:string;reportDate:string;savedAt:unknown}) {
  const [result,setResult]=useState<{rows:PayrollLiveChange[];failed:boolean}>({rows:[],failed:false});
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      const client=createSupabaseBrowserClient(); if(!client){if(active)setResult({rows:[],failed:true});return;}
      const rows:PayrollLiveChange[]=[];
      for(let offset=0;;offset+=1000){
        const {data,error}=await client.from("payroll_live_change_history").select("*").eq("salon_id",salonId).eq("source_table","pos_daily_closings").eq("period_start",reportDate).order("created_at",{ascending:false}).order("id").range(offset,offset+999);
        if(error){if(active)setResult({rows:[],failed:true});return;}
        rows.push(...data??[]);if(!data||data.length<1000)break;
      }
      if(active)setResult({rows,failed:false});
    };
    void load(); return()=>{active=false;};
  },[salonId,reportDate,savedAt]);
  return result.failed?<p role="status"><WorkspaceText text="Change history could not be loaded. Please retry."/></p>:<PayrollChangeHistory changes={result.rows} compact title="Daily Report change history"/>;
}
