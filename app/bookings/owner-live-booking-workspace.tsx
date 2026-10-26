"use client";
import { useState,useRef,useEffect,useLayoutEffect,useCallback,useMemo,type ComponentProps } from 'react';
import { useExperienceResource } from '@/lib/use-experience-resource';
import {createWorkspaceRefreshQueue} from '@/lib/workspace-refresh-queue';
import { useExperienceScope } from '@/components/experience-scope';
import { experienceResourceCache } from '@/lib/experience-resource-cache';
import { fetchWorkspaceResource } from '@/lib/fetch-workspace-resource';
import { useSearchParams } from 'next/navigation';
import { usePosResourceRefresh } from '@/lib/pos-workspace-sync';
import { usePersistentReadView } from '@/lib/use-persistent-read-view';
import { BookingWorkspaceClient } from './booking-workspace-client';
export function OwnerLiveBookingWorkspace(props:ComponentProps<typeof BookingWorkspaceClient>&{salonId:string;snapshotAt?:number;query?:string;managedRead?:boolean}){
 const {salonId,snapshotAt,query,managedRead=false}=props;
 const initial=useMemo(()=>{
   const {salonId:unusedSalon,snapshotAt:unusedStamp,query:unusedQuery,managedRead:unusedManaged,...data}=props;
   void unusedSalon;void unusedStamp;void unusedQuery;void unusedManaged;
   return data;
 },[props]);
 const routeParams=useSearchParams();
 const params=useMemo(()=>query===undefined?routeParams:new URLSearchParams(query),[query,routeParams]);
 const generation=useRef(0);
 const scope=useExperienceScope()?.context.scope;
 const snapshotKey='owner-bookings?'+params.toString();
 const policy={tags:['booking','catalog','settings'],freshForMs:30000,retainForMs:30*60000};
 const [mountedAt]=useState(()=>Date.now());
 const [oversize,setOversize]=useState<{base:typeof initial.bookings;data:typeof initial}|null>(null);
 const retained=useExperienceResource({scope:scope??'unavailable',key:snapshotKey,initialData:initial,
   initialUpdatedAt:snapshotAt??mountedAt,...policy,enabled:false,fetcher:async()=>({data:initial})});
 const data=oversize?.base===initial.bookings?oversize.data:retained.data??initial;
 const latest=useRef(data);
 useLayoutEffect(()=>{latest.current=data;},[data]);
 usePersistentReadView({scope,domain:'owner-bookings',params:params.toString(),data,
   updatedAt:Math.max(snapshotAt??0,scope?experienceResourceCache.get({scope,key:snapshotKey})?.updatedAt??0:0),
   validate:(value:unknown):value is typeof initial=>{const item=value as Partial<typeof initial>|null;return Boolean(item&&Array.isArray(item.bookings)&&Array.isArray(item.requests)&&item.options&&item.filters&&typeof item.timezone==='string'&&typeof item.canManageBookings==='boolean');},
   onRestore:(value,updatedAt)=>{if(!scope)return;if(experienceResourceCache.seed({scope,key:snapshotKey},value,policy,updatedAt))setOversize(null);else setOversize({base:initial.bookings,data:value});},
 });
 useEffect(()=>{generation.current+=1;},[initial.bookings,scope,snapshotKey]);
 const load=async(ids?:string[],configuration=false)=>{
   const startedGeneration=generation.current;
   const query=new URLSearchParams(params);
   if(!configuration)query.set('resource','calendar');
   if(ids?.length)query.set('ids',ids.join(','));
   if(!scope)return;
   const url='/api/pos/owner/bookings?'+query.toString();
   type Patch={salonId:string;workspace:Partial<typeof initial>&{bookings:typeof initial.bookings;timeBlocks:typeof initial.options.timeBlocks}};
   const next=await experienceResourceCache.load({scope,key:url},fetchWorkspaceResource<Patch>(url,scope),{...policy,force:true});
   if(next.salonId===salonId && Array.isArray(next.workspace.bookings) && startedGeneration===generation.current && experienceResourceCache.isAvailable({scope,key:snapshotKey})){
     const previous=experienceResourceCache.get<typeof initial>({scope,key:snapshotKey})?.data??latest.current;
     const merged={...previous,...next.workspace,
       bookings:ids?.length?[...previous.bookings.filter(booking=>!ids.includes(booking.id)),...next.workspace.bookings]:next.workspace.bookings,
       options:configuration?next.workspace.options??previous.options:{...previous.options,timeBlocks:next.workspace.timeBlocks},
     };
     if(experienceResourceCache.seed({scope,key:snapshotKey},merged,policy))setOversize(null);
     else setOversize({base:initial.bookings,data:merged});
   }
 };
 const loadRef=useRef(load);
 const activeKey=useRef(snapshotKey+scope);
 useLayoutEffect(()=>{loadRef.current=load;activeKey.current=snapshotKey+scope;});
 const refreshQueue=useRef<ReturnType<typeof createWorkspaceRefreshQueue>|null>(null);
 useLayoutEffect(()=>{
   const owner=snapshotKey+scope;
   refreshQueue.current=createWorkspaceRefreshQueue((ids,configuration)=>activeKey.current===owner?loadRef.current(ids,configuration):Promise.resolve());
 },[scope,snapshotKey]);
 const refresh=useCallback((ids?:string[],configuration=false)=>refreshQueue.current?.(ids,configuration)??Promise.resolve(),[]);
 const retainedAt=scope?experienceResourceCache.get({scope,key:snapshotKey})?.updatedAt:undefined;
 const currentSnapshotAt=Math.max(snapshotAt??0,retainedAt??0)||snapshotAt;
 const configAt=scope?experienceResourceCache.get({scope,key:'/api/pos/owner/bookings?'+params.toString()})?.updatedAt:undefined;
 const configSnapshotAt=Math.max(snapshotAt??0,configAt??0)||snapshotAt;
 usePosResourceRefresh(salonId,'booking',ids=>refresh(ids),{enabled:!managedRead,initialReconcile:false,snapshotAt:currentSnapshotAt,freshForMs:30000});
 usePosResourceRefresh(salonId,'settings',()=>refresh(undefined,true),{enabled:!managedRead,initialReconcile:false,snapshotAt:configSnapshotAt,freshForMs:60000});
 usePosResourceRefresh(salonId,'catalog',()=>refresh(undefined,true),{enabled:!managedRead,initialReconcile:false,snapshotAt:configSnapshotAt,freshForMs:60000});
 return retained.available?<BookingWorkspaceClient {...data}/>:null;
}

