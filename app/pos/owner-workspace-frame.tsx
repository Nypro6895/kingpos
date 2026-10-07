"use client";
import {usePathname, useRouter} from "next/navigation";
import {useEffect, type ReactNode} from "react";
import {OwnerPosTabs} from "./owner-pos-tabs";
export function OwnerWorkspaceFrame({checkout,children}:{checkout:ReactNode;children:ReactNode;salonName?:string}){
 const path=usePathname();
 const router=useRouter();
 useEffect(()=>{window.dispatchEvent(new Event("resize"));},[path]);
 const active=path.startsWith('/pos/ticket')?'ticket':path==='/pos/book'?'book':path==='/pos/check-in'?'checkIn':path==='/pos/report'?'report':'pos';
 function workspaceHref(href:string){return href.replace(/^\/pos-tickets(?=\/|\?|#|$)/,'/pos/ticket').replace(/^\/bookings(?=\?|#|$)/,'/pos/book').replace(/^\/reports(?=\?|#|$)/,'/pos/report');}
 return <div data-owner-workspace onClickCapture={event=>{
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const link=(event.target as Element).closest<HTMLAnchorElement>('a[href]');
  if(!link||link.target||link.hasAttribute('download')||link.closest('.owner-menu-dialog'))return;
  const url=new URL(link.href,location.href);if(url.origin!==location.origin)return;
  const target=workspaceHref(url.pathname+url.search+url.hash);
  if(target!==url.pathname+url.search+url.hash){event.preventDefault();event.stopPropagation();router.push(target);}
 }} onSubmitCapture={event=>{
  const form=event.target as HTMLFormElement;if(form.method.toLowerCase()!=='get')return;
  const url=new URL(form.action,location.href);const target=workspaceHref(url.pathname);
  if(target!==url.pathname){event.preventDefault();event.stopPropagation();const params=new URLSearchParams();new FormData(form).forEach((value,key)=>{if(typeof value==='string')params.append(key,value);});router.push(target+'?'+params);}
 }}>
  <div hidden={active!=='pos'}>{checkout}</div>
  {active!=='pos'?<section className="owner-workspace-panel">
   <OwnerPosTabs active={active}/>
   <div className="owner-workspace-content">{children}</div>
  </section>:null}
 </div>;
}
