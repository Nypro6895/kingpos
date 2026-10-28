"use client";
import { useEffect, useState } from "react";
import type { PayrollLiveChange } from "@/types/payroll-live-history";
import { PayrollChangeHistory } from "@/app/payroll/payroll-change-history";
import { WorkspaceText } from "@/components/workspace-language";

export function DailyReportChangeHistory({salonId,reportDate,savedAt}:{salonId:string;reportDate:string;savedAt:unknown}) {
  const [result,setResult]=useState<{rows:PayrollLiveChange[];failed:boolean}>({rows:[],failed:false});
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try {
        const response = await fetch('/api/pos/closing/history?' + new URLSearchParams({salonId,date:reportDate}), {credentials:'same-origin',cache:'no-store'});
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.rows)) throw new Error('History unavailable');
        if(active)setResult({rows:result.rows,failed:false});
      } catch { if(active)setResult({rows:[],failed:true}); }
    };
    void load(); return()=>{active=false;};
  },[salonId,reportDate,savedAt]);
  return result.failed?<p role="status"><WorkspaceText text="Change history could not be loaded. Please retry."/></p>:<PayrollChangeHistory changes={result.rows} compact title="Daily Report change history"/>;
}
