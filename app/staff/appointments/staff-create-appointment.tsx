"use client";
import "./staff-appointments.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StaffCustomerFields } from "./staff-customer-fields";

type Catalog = {enabled: boolean; staffId: string; timezone: string; services: {id: string; name: string; price: number; minutes: number}[]; staff: {id: string; name: string}[]; assignments: {staffId: string; serviceId: string}[]};
const endpoint = "/api/staff/create-appointment";
async function readResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Unable to load booking options.");
  return data;
}
export function StaffCreationPermission({salonId}: {salonId: string}) {
  const [enabled, setEnabled] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {let active = true; fetch(`${endpoint}?salonId=${salonId}`).then(readResponse).then(data => {if(active) setEnabled(data.enabled);}).catch(error => {if(active)setError(error.message);}); return () => {active = false;};}, [salonId]);
  return <section id="staff-appointment-permission" className="flex flex-wrap items-center justify-between gap-3 border-y border-border-subtle bg-white px-5 py-4"><div><h3 className="text-sm font-semibold">Staff can create appointments</h3><p className="mt-1 text-xs text-text-secondary">Allow active staff to create appointments for this salon. Enabled by default.</p></div><button type="button" role="switch" aria-label="Staff can create appointments" aria-checked={enabled === true} disabled={busy || enabled === null} className="min-h-10 min-w-16 rounded-full border border-border-subtle px-4 text-sm font-semibold disabled:opacity-50" onClick={async () => {setBusy(true);setError("");try {const data=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({salonId,action:"permission",enabled:!enabled})}).then(readResponse);setEnabled(data.enabled);}catch(error){setError(error instanceof Error?error.message:"Unable to save.");}finally{setBusy(false);}}}>{busy ? "Saving…" : enabled === null ? "Loading…" : enabled ? "On" : "Off"}</button>{error ? <p role="alert" className="w-full text-sm text-red-700">{error}</p>:null}</section>;
}

export function StaffCreateAppointment(props: {salonId: string; date: string}) {
  return <StaffCreateForm key={props.salonId} {...props}/>;
}
function StaffCreateForm({salonId, date}: {salonId: string; date: string}) {
  const router = useRouter(), dialog = useRef<HTMLDialogElement>(null), inFlight = useRef(false);
  const [enabled,setEnabled]=useState(true), [catalog,setCatalog]=useState<Catalog|null>(null), [busy,setBusy]=useState(false), [error,setError]=useState("");
  const [staffId,setStaffId]=useState(""), [serviceIds,setServiceIds]=useState<string[]>([]), [key,setKey]=useState("");
  const [success,setSuccess]=useState("");
  const pending = useRef<Promise<void> | null>(null), loadedAt = useRef(0);
  const [catalogError, setCatalogError] = useState("");
  const loadCatalog = useCallback(() => {
    if (pending.current) return pending.current;
    if (Date.now() - loadedAt.current < 60_000) return Promise.resolve();
    setCatalogError("");
    pending.current = fetch(`${endpoint}?salonId=${salonId}&catalog=1`, {signal: AbortSignal.timeout(15000)})
      .then(readResponse).then((data: Catalog) => {
        setEnabled(data.enabled);
        if (data.enabled) {setCatalog(data);setStaffId(current => current || data.staffId);loadedAt.current=Date.now();}
      }).catch(() => setCatalogError("Booking options could not load. Please retry."))
      .finally(() => {pending.current=null;});
    return pending.current;
  }, [salonId]);
  useEffect(() => {void loadCatalog();}, [loadCatalog]);
  if (!enabled) return null;
  return <><button type="button" aria-label="Create appointment" className="staff-create-trigger" onClick={()=>{
    setError("");setSuccess("");setKey(crypto.randomUUID());setServiceIds([]);
    if(catalog)setStaffId(catalog.staffId);
    dialog.current?.showModal();void loadCatalog();
  }}><span aria-hidden="true">＋</span> New</button>
    <dialog ref={dialog} className="staff-create-dialog" aria-label="Create appointment" onCancel={event=>{if(inFlight.current)event.preventDefault();}}>
      <header><h2>New appointment</h2><button type="button" disabled={busy} aria-label="Close create appointment" onClick={()=>dialog.current?.close()}>×</button></header>
      {error?<p role="alert">{error}</p>:null}
      {success?<div><p role="status">{success}</p><button type="button" onClick={()=>dialog.current?.close()}>Done</button></div>:<form key={key} onSubmit={async event=>{
        event.preventDefault();if(inFlight.current || !catalog)return;inFlight.current=true;setBusy(true);setError("");
        const fields=new FormData(event.currentTarget);
        try {
          const data=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create",salonId,appointment:{key,staffId,serviceIds,customerId:fields.get("customerId"),name:fields.get("name"),phone:fields.get("phone"),note:fields.get("note"),startLocal:`${fields.get("date")}T${fields.get("time")}`}})}).then(readResponse);
          setSuccess(data.assignedToSelf?"Appointment created in your schedule.":"Appointment created for the selected professional. It appears in their schedule.");router.refresh();
        } catch(error) {setError(error instanceof Error?error.message:"Unable to create appointment.");}
        finally {inFlight.current=false;setBusy(false);}
      }}>
        <StaffCustomerFields salonId={salonId} disabled={busy}/>
        {catalogError ? <p role="alert">{catalogError} <button type="button" onClick={()=>void loadCatalog()}>Retry</button></p> : !catalog ? <p role="status">Loading services and professionals… You can enter customer details now.</p> : null}
        <label>Professional<select value={staffId} disabled={busy || !catalog} onChange={event=>{setStaffId(event.target.value);setServiceIds([]);}}>{!catalog ? <option>Loading…</option> : null}{catalog?.staff.map(staff=><option key={staff.id} value={staff.id}>{staff.name}{staff.id===catalog.staffId?" (you)":""}</option>)}</select></label>
        <fieldset disabled={busy || !catalog}><legend>Services</legend>{catalog?.services.filter(service=>catalog.assignments.some(a=>a.staffId===staffId&&a.serviceId===service.id)).map(service=><label className="staff-create-service" key={service.id}><input type="checkbox" checked={serviceIds.includes(service.id)} onChange={event=>setServiceIds(current=>event.target.checked?[...current,service.id]:current.filter(id=>id!==service.id))}/><span>{service.name}</span></label>)}{catalog && !catalog.assignments.some(a=>a.staffId===staffId)?<p>No assigned services for this professional.</p>:null}</fieldset>
        <div className="staff-create-date"><label>Date<input type="date" name="date" required defaultValue={date} disabled={busy}/></label><label>Time<input type="time" name="time" required step={900} disabled={busy}/></label></div>
        <label>Note (optional)<textarea name="note" maxLength={2000} rows={2} disabled={busy}/></label>
        <button className="staff-appointments-primary-button" type="submit" disabled={busy||!catalog||!serviceIds.length}>{busy?"Creating…":"Create appointment"}</button>
      </form>}
    </dialog></>;
}
