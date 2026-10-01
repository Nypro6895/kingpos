"use client";
import { useState,type ComponentProps } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePosResourceRefresh } from '@/lib/pos-workspace-sync';
import { BookingWorkspaceClient } from './booking-workspace-client';
export function OwnerLiveBookingWorkspace({salonId,...initial}:ComponentProps<typeof BookingWorkspaceClient>&{salonId:string}){
 const [live,setLive]=useState<{base:typeof initial.bookings;data:typeof initial}|null>(null);
 const data=live?.base===initial.bookings?live.data:initial;
 const params=useSearchParams();
 usePosResourceRefresh(salonId,'booking',async()=>{
   const response=await fetch('/api/pos/owner/bookings?'+params.toString(),{cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!response.ok)return;const next=await response.json();
   if(next.salonId===salonId)setLive({base:initial.bookings,data:{...initial,...next.workspace}});
 });
 return <BookingWorkspaceClient {...data}/>;
}
