"use client";
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
      try {await onSaved?.();} catch {setMessage("Saved. Reload to refresh booking readiness.");}
    } catch {setError(true);setMessage("Could not save online booking. Please try again.");}
    finally {lock.current=false;setBusy(false);}
  }
  return <section className="staff-hours-booking" aria-label="Online booking">
    <div className="staff-hours-booking-row"><div><strong><WorkspaceText text="Online booking" /></strong><small><WorkspaceText text={!member.is_active?"Inactive staff":!enabled?"Off · Not accepting online bookings":!baseline.some(id=>services.some(s=>s.id===id))?"On · Select online services":"On · Online services assigned"}/></small></div>
      <label className="staff-hours-switch"><input type="checkbox" role="switch" aria-label="Allow online booking" checked={enabled} disabled={busy||!canManageOnline||!member.is_active} onChange={e=>void save("toggle",e.target.checked)}/><span aria-hidden="true"/></label>
    </div>
    <SettingsDetails><summary><WorkspaceText text="Online services"/> · {baseline.filter(id=>services.some(s=>s.id===id)).length}</summary>
      {!services.length?<p><WorkspaceText text="No active online services in this salon."/></p>:<fieldset disabled={busy||!setup.permissions.canManageAssignments}>
        <legend className="sr-only"><WorkspaceText text="Online services"/></legend>
        {services.map(service=><label className="staff-hours-service" key={service.id}><input type="checkbox" checked={selected.includes(service.id)} onChange={e=>setSelected(e.target.checked?[...selected,service.id]:selected.filter(id=>id!==service.id))}/><span>{service.name}</span></label>)}
        {dirty?<div className="staff-hours-booking-actions"><button type="button" onClick={()=>void save("services")}><WorkspaceText text={busy?"Saving…":"Save online services"}/></button><button type="button" onClick={()=>setSelected([...baseline])}><WorkspaceText text="Discard"/></button></div>:null}
      </fieldset>}
    </SettingsDetails>
    {enabled&&setup.readinessByStaffId[member.id]?.reasons.length?<p className="staff-hours-readiness"><WorkspaceText text="Booking readiness:"/> {setup.readinessByStaffId[member.id].reasons.map(reason=>reason.label).join(", ")}</p>:null}
    {message?<p role={error?"alert":"status"}><WorkspaceText text={message}/></p>:null}
  </section>;
}
