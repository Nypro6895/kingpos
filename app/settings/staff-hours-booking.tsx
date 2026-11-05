"use client";
import { StaffBookingGuide } from "./booking-setup-guide";
import { salonSetupHref } from "@/lib/salon-setup-navigation";
import {SettingsDetails} from "@/app/settings/settings-child-pages";


import { useEffect, useRef, useState } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import type { BookingSetupData } from "@/lib/booking-setup";
import { saveStaffHoursBooking } from "./staff-hours-booking-actions";

export function StaffHoursBooking({salonId, member, setup, canManageOnline, onSaved}: {
  salonId:string; member:BookingSetupData["staff"][number]; setup:BookingSetupData;
  canManageOnline:boolean; onSaved?:()=>void|Promise<void>;
}) {
  const services=setup.services.filter(s=>s.is_active&&s.online_booking_enabled&&!s.booking_parent_service_id);
  const initial=setup.assignments.filter(a=>a.staff_id===member.id&&a.is_active&&a.online_bookable).map(a=>a.service_id);
  const [enabled,setEnabled]=useState(member.online_booking_enabled);
  const [selected,setSelected]=useState(initial);
  const [baseline,setBaseline]=useState(initial);
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState(false);
  const dirty=JSON.stringify([...selected].sort())!==JSON.stringify([...baseline].sort());
  const incoming=JSON.stringify([...initial].sort());
  const [seenEnabled,setSeenEnabled]=useState(member.online_booking_enabled);
  const [seenIncoming,setSeenIncoming]=useState(incoming);
  if(!busy&&seenEnabled!==member.online_booking_enabled){setSeenEnabled(member.online_booking_enabled);setEnabled(member.online_booking_enabled);}
  if(!dirty&&!busy&&seenIncoming!==incoming){
    setSeenIncoming(incoming);
    const values=JSON.parse(incoming) as string[];
    setSelected(previous=>JSON.stringify([...previous].sort())===incoming?previous:values);
    setBaseline(previous=>JSON.stringify([...previous].sort())===incoming?previous:values);
  }
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty]);
  async function save(kind:"toggle"|"services",next=enabled) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setMessage("");setError(false);
    try {
      const result=await saveStaffHoursBooking({salonId,staffId:member.id,...(kind==="toggle"?{enabled:next}:{serviceIds:selected.filter(id=>services.some(s=>s.id===id))})});
      if(!result.ok){setError(true);setMessage(result.error);return;}
      if(kind==="toggle")setEnabled(next);else setBaseline([...selected]);
      setMessage("Saved.");
      // The write succeeded even if refreshing the surrounding panel fails.
      try {await onSaved?.();} catch {setMessage("Saved. Reopen this page to check what is still needed.");}
    } catch {setError(true);setMessage("Could not save online booking. Please try again.");}
    finally {lock.current=false;setBusy(false);}
  }
  return <section data-settings-dirty={dirty} className="staff-hours-booking" aria-label="Online booking">
    <div className="staff-hours-booking-row"><div><strong><WorkspaceText text="Online booking" /></strong><small><WorkspaceText text={!member.is_active?"Inactive staff":!enabled?"Off · Not accepting online bookings":!baseline.some(id=>services.some(s=>s.id===id))?"On · Select online services":"On · Online services assigned"}/></small></div>
      <label className="staff-hours-switch"><input type="checkbox" role="switch" aria-label="Allow online booking" checked={enabled} disabled={busy||!canManageOnline||!member.is_active} onChange={e=>void save("toggle",e.target.checked)}/><span aria-hidden="true"/></label>
    </div>
    <SettingsDetails id={`staff-services-${member.id}`}><summary><WorkspaceText text="Online services"/></summary>
      {!services.length?<p><WorkspaceText text="No active online services in this salon."/> <a href={salonSetupHref(salonId,"services")}><WorkspaceText text="Add a service customers can book online"/> →</a></p>:<fieldset disabled={busy||!setup.permissions.canManageAssignments}>
        <legend className="sr-only"><WorkspaceText text="Online services"/></legend>
        {services.map(service=><label className="staff-hours-service" key={service.id}><input type="checkbox" checked={selected.includes(service.id)} onChange={e=>setSelected(e.target.checked?[...selected,service.id]:selected.filter(id=>id!==service.id))}/><span>{service.name}</span></label>)}
        {dirty?<div className="staff-hours-booking-actions"><button type="button" onClick={()=>void save("services")}><WorkspaceText text={busy?"Saving…":"Save online services"}/></button><button type="button" onClick={()=>setSelected([...baseline])}><WorkspaceText text="Discard"/></button></div>:null}
      </fieldset>}
    </SettingsDetails>
    {enabled&&setup.readinessByStaffId[member.id]?<StaffBookingGuide salonId={salonId} readiness={setup.readinessByStaffId[member.id]} permissions={{...setup.permissions,canManageOnline}}/>:null}
    {message?<p className="settings-page-persistent" role={error?"alert":"status"}><WorkspaceText text={message}/></p>:null}
  </section>;
}
