"use client";
import { useEffect } from "react";
import { syncPortableOperations } from "@/lib/portable-operations";

// The Owner cart is a page; its durable outbox belongs to the whole workspace.
// Keep uploading when the owner navigates to Settings, Booking or Reports.
export function OwnerQueueRuntime({scope}:{scope:string|null}) {
  useEffect(()=>{
    if(!scope)return;
    const sync=()=>{if(navigator.onLine)void syncPortableOperations(scope).catch(()=>{});};
    const initial=setTimeout(sync,0),timer=setInterval(sync,5000);
    window.addEventListener('online',sync);window.addEventListener('focus',sync);
    return()=>{clearTimeout(initial);clearInterval(timer);window.removeEventListener('online',sync);window.removeEventListener('focus',sync);};
  },[scope]);
  return null;
}
