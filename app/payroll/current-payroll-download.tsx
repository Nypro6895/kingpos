"use client";
import { useState } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import { downloadMyCurrentPayroll } from "./current-payroll-download-actions";

export function CurrentStaffPayrollDownload(input:{periodStart:string;periodEnd:string;salonId:string;staffId:string}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  return <div><button type="button" disabled={busy} className="min-h-11 rounded-lg border px-4 py-2 text-sm" onClick={async()=>{
    setBusy(true);setError("");
    try{const file=await downloadMyCurrentPayroll(input);const url=URL.createObjectURL(new Blob([file.csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    catch(reason){setError(reason instanceof Error?reason.message:"Download failed.");}finally{setBusy(false);}
  }}><WorkspaceText text={busy?"Preparing…":"Download current payroll"}/></button>{error&&<p role="alert"><WorkspaceText text={error}/></p>}</div>;
}
