"use client";
import Link from "next/link";
import { BeautyProfileClient } from "@/app/beauty/beauty-profile-client";
import { NotificationCenterClient } from "@/app/notifications/notification-center-client";
import { getAppLocalHost } from "./app-local-host";
import { useAppLocalResource } from "./app-local-resource";
import type { AppLocalPage,AppLocalPageProps } from "./app-local-page-registry";
import type { AppLocalBeautyData,AppLocalNotificationData } from "./app-local-personal-metadata";
function NextAppointment({booking}:{booking:AppLocalBeautyData["booking"]}){
  return <section className="relative rounded-2xl border border-border-subtle bg-surface p-4" aria-label="Your next appointment">
    <span role="img" className="absolute right-3 top-3 text-text-secondary" title="Only you can see your appointment" aria-label="Only you can see your appointment"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>
    <p className="text-xs font-semibold text-text-secondary">Next appointment</p>
    {booking?<><h2 className="mt-2 pr-6 text-lg font-semibold">{new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:booking.salon_timezone_snapshot}).format(new Date(booking.start_at))}</h2><p className="mt-1 text-sm text-text-secondary"><Link href={`/explore/salons/${booking.salon_id}`} className="hover:underline">{booking.salon?.displayName??"Salon appointment"}</Link></p><p className="mt-1 text-xs text-text-secondary">{booking.lines?.filter(line=>line.line_type==="service").map(line=>line.service_name_snapshot).join(" · ")}</p><div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs capitalize text-brand-teal">{booking.status.replaceAll("_"," ")}</span><Link className="inline-flex min-h-10 items-center text-sm font-semibold text-brand-teal" href={`/my-bookings/${booking.id}`}>View booking →</Link></div></>:<p className="mt-2 text-sm text-text-secondary">No upcoming appointments. <Link href="/my-bookings" className="text-brand-teal">View bookings</Link></p>}
  </section>;
}
function PersonalPage(props:AppLocalPageProps){
  const url=new URL(props.path,"https://reylumi.com"),beauty=url.pathname==="/beauty",args=beauty?{}:{filter:url.searchParams.get("filter")==="unread"?"unread":"all"};
  const resource=useAppLocalResource<AppLocalBeautyData|AppLocalNotificationData>(props.context?.context.scope,beauty?"page.beauty":"page.notifications",args,{enabled:Boolean(props.context?.context.authenticated)});
  const title=beauty?"Beauty":"Notifications";
  if(!props.context?.context.authenticated)return <main className="p-6"><h1 className="text-2xl font-semibold">{title}</h1><button className="mt-4 rounded border px-4 py-2" onClick={()=>void getAppLocalHost().openOnline("/login?next="+encodeURIComponent(url.pathname))}>Sign in</button></main>;
  if(!resource.data)return <main className="p-6" aria-busy={resource.loading||resource.refreshing}><h1 className="text-2xl font-semibold">{title}</h1>{resource.error?<><p role="alert">{resource.error}</p><button className="mt-4 rounded border px-4 py-2" onClick={()=>void resource.refresh()}>Try again</button></>:<p className="mt-4">Opening…</p>}</main>;
  if(beauty){const data=resource.data as AppLocalBeautyData;return <BeautyProfileClient appointment={<NextAppointment booking={data.booking}/>} commentViewer={data.commentViewer} initialTimeline={data.profile.timeline} profile={data.profile.profile} visitCandidates={data.profile.visitCandidates}/>;}
  return <NotificationCenterClient {...resource.data as AppLocalNotificationData}/>;
}
export function getAppLocalPersonalPage(path:string):AppLocalPage|null{
  const pathname=path.split("?")[0];if(pathname!=="/beauty"&&pathname!=="/notifications")return null;
  return{id:pathname==="/beauty"?"personal.beauty":"personal.notifications",title:pathname==="/beauty"?"Beauty":"Notifications",requiresContext:true,Component:PersonalPage,features:["complete-original-view","scoped-retained-data","existing-guarded-actions"]};
}
