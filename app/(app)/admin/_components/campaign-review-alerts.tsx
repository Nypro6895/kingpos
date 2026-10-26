"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {AdminIcon} from "./admin-icon";
import {useRouter} from "next/navigation";
import {campaignAdminNoticesAction,type CampaignAdminNotices} from "../advertising/reviews/actions";
export function CampaignReviewAlerts(){
 const router=useRouter();const [notices,setNotices]=useState<CampaignAdminNotices|null>(null);const [error,setError]=useState(false);
 useEffect(()=>{let active=true;async function load(){if(document.visibilityState!=="visible")return;try{const next=await campaignAdminNoticesAction();if(active){setNotices(next);setError(false);}}catch{if(active){setNotices(null);setError(true);}}}void load();const timer=setInterval(()=>void load(),30000);const reload=()=>void load();window.addEventListener("campaign:reviewed",reload);return()=>{active=false;clearInterval(timer);window.removeEventListener("campaign:reviewed",reload);};},[]);
 return <details className="admin-account-menu"><summary aria-label={`Ad review notifications${notices?`: ${notices.unread} unread`:""}`}><AdminIcon name="notifications" size={18}/><span className="sr-only">Ad reviews</span>{notices?.unread?<span className="admin-nav-count" aria-hidden="true">{notices.unread>99?"99+":notices.unread}</span>:null}</summary><div style={{maxHeight:420,overflow:"auto",minWidth:240}}>{error?<p role="status">Review notifications could not load.</p>:!notices?<p>Loading…</p>:!notices.items.length?<p>No ad review notifications yet.</p>:notices.items.map(item=><Link key={item.id} href={`/admin/plugins/campaigns?campaign=${item.campaign_id}`} onClick={async e=>{e.preventDefault();try{setNotices(await campaignAdminNoticesAction(item.id));}catch{setError(true);}router.push(`/admin/plugins/campaigns?campaign=${item.campaign_id}`);}}><strong>{item.title}</strong><br/><small>{item.resolved_at?"No longer awaiting review":item.read_at?"Awaiting review":"New · awaiting review"} · {new Date(item.created_at).toLocaleString()}</small></Link>)}<Link href="/admin/plugins/campaigns">Open all ad reviews →</Link></div></details>;
}
