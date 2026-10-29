"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { OwnerPosIcon, type OwnerPosIconName } from "./owner-pos-icon";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import "./owner-notebook-menu.css";
import { OwnerWindowsCompactMenu } from "./owner-windows-compact-menu";
const pages: { id: string; label: string; icon: OwnerPosIconName; href: string }[] = [
 { id:"pos",label:"POS",icon:"pos",href:"/pos" },
 { id:"ticket",label:"Ticket",icon:"ticket",href:"/pos/ticket" },
 { id:"book",label:"Book",icon:"booking",href:"/pos/book" },
 { id:"checkIn",label:"Check In",icon:"checkin",href:"/pos/check-in" },
 { id:"report",label:"Report",icon:"report",href:"/pos/report" },
 { id:"settings",label:"Settings",icon:"settings",href:"/pos/settings" },
];
export function OwnerNotebookMenu({active,more}:{active:string;more:ReactNode}) {
 const translate=useWorkspaceTranslation();
 const [compactWindows,setCompactWindows]=useState(false);
 useEffect(()=>{
  // iPadOS can report Macintosh; a width breakpoint would also change Windows.
  const ua=navigator.userAgent;
  const tablet=/iPad/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1)||(/Android/.test(ua)&&!/Mobile/.test(ua));
  const phone=/iPhone|iPod|Android.*Mobile/.test(ua);
  // Narrow iPad Split View uses the compact bottom bar as well.
  const update=()=>{document.documentElement.dataset.ownerDevice=tablet&&innerWidth>=700?'tablet':phone||tablet?'phone':'desktop';const compact=!tablet&&!phone&&innerWidth<980;document.documentElement.dataset.ownerCompactWindows=String(compact);setCompactWindows(compact);};
  update();window.addEventListener('resize',update);
  window.dispatchEvent(new Event('resize'));
  return()=>window.removeEventListener('resize',update);
 },[]);
 if(compactWindows)return <OwnerWindowsCompactMenu active={active} more={more}/>;
 return <nav className="owner-device-nav" aria-label={translate('Owner POS')}>
  {pages.map(page=><Link key={page.id} href={page.href} data-page={page.id} data-owner-tab={page.id} aria-label={translate(page.label)} aria-current={active===page.id?'page':undefined}><OwnerPosIcon name={page.icon}/><span>{translate(page.label)}</span></Link>)}
  {more}
 </nav>;
}
