"use client";

import { useEffect, useRef } from "react";
import { usePayrollRefresh } from "./payroll-live-refresh";
import { createSettledRefreshQueue } from "@/lib/settled-refresh-queue";

const listeners=new Map<symbol,()=>void>();
const queue=createSettledRefreshQueue(()=>listeners.values().next().value?.());

export function usePayrollRefreshBatch(pending:boolean,savedAt:string|null) {
  const refresh=usePayrollRefresh();
  const id=useRef(Symbol("payroll-row"));
  const acknowledged=useRef(savedAt);
  useEffect(()=>{
    const token=id.current;
    listeners.set(token,()=>void refresh());
    return()=>{listeners.delete(token);queue.remove(token);if(!listeners.size)queue.dispose();};
  },[refresh]);
  useEffect(()=>{
    if(pending){queue.begin(id.current);return;}
    const changed=Boolean(savedAt && savedAt!==acknowledged.current);
    acknowledged.current=savedAt;
    queue.finish(id.current,changed);
  },[pending,savedAt]);
}
