"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createSettledRefreshQueue } from "@/lib/settled-refresh-queue";

const listeners=new Map<symbol,()=>void>();
const queue=createSettledRefreshQueue(()=>listeners.values().next().value?.());

export function usePayrollRefreshBatch(pending:boolean,savedAt:string|null) {
  const router=useRouter();
  const id=useRef(Symbol("payroll-row"));
  const acknowledged=useRef(savedAt);
  useEffect(()=>{
    const token=id.current;
    listeners.set(token,()=>router.refresh());
    return()=>{listeners.delete(token);queue.remove(token);if(!listeners.size)queue.dispose();};
  },[router]);
  useEffect(()=>{
    if(pending){queue.begin(id.current);return;}
    const changed=Boolean(savedAt && savedAt!==acknowledged.current);
    acknowledged.current=savedAt;
    queue.finish(id.current,changed);
  },[pending,savedAt]);
}
