"use client";
import { useState,useRef,useEffect,type ComponentProps } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePosResourceRefresh } from '@/lib/pos-workspace-sync';
import { BookingWorkspaceClient } from './booking-workspace-client';
export function OwnerLiveBookingWorkspace({salonId,snapshotAt,...initial}:ComponentProps<typeof BookingWorkspaceClient>&{salonId:string;snapshotAt?:number}){
 const [live,setLive]=useState<{base:typeof initial.bookings;data:typeof initial}|null>(null);
 const data=live?.base===initial.bookings?live.data:initial;
 const params=useSearchParams();
 const inFlight=useRef(new Map<string,Promise<void>>());
 const generation=useRef(0);
 useEffect(()=>{generation.current+=1;},[initial.bookings]);
 const load=async(ids?:string[],configuration=false)=>{
   const startedGeneration=generation.current;
   const query=new URLSearchParams(params);
   if(!configuration)query.set('resource','calendar');
   if(ids?.length)query.set('ids',ids.join(','));
   const response=await fetch('/api/pos/owner/bookings?'+query.toString(),{cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!response.ok)return;const next=await response.json();
   if(next.salonId===salonId && startedGeneration===generation.current)setLive(current=>{
     const previous=current?.base===initial.bookings?current.data:initial;
     return {base:initial.bookings,data:{...previous,...next.workspace,
       bookings:ids?.length?[...previous.bookings.filter(booking=>!ids.includes(booking.id)),...next.workspace.bookings]:next.workspace.bookings,
       options:configuration?next.workspace.options:{...previous.options,timeBlocks:next.workspace.timeBlocks},
     }};
   });
 };
 const refresh=(ids?:string[],configuration=false)=>{
   const key=JSON.stringify([configuration,params.toString(),ids?.slice().sort()]);
   const existing=inFlight.current.get(key);if(existing)return existing;
   const request=load(ids,configuration).finally(()=>inFlight.current.delete(key));
   inFlight.current.set(key,request);return request;
 };
 usePosResourceRefresh(salonId,'booking',ids=>refresh(ids),{initialReconcile:false,snapshotAt});
 usePosResourceRefresh(salonId,'settings',()=>refresh(undefined,true),{initialReconcile:false,snapshotAt});
 usePosResourceRefresh(salonId,'catalog',()=>refresh(undefined,true),{initialReconcile:false,snapshotAt});
 return <BookingWorkspaceClient {...data}/>;
}
