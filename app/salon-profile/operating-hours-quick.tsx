"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadProfileOperatingHours, saveProfileOperatingHours } from "./operating-hours-actions";
import type { UpdateSalonOperatingHoursInput } from "@/types/salon-operating-status";
import styles from "./operating-hours-quick.module.css";

const days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export function OperatingHoursQuick({salonId}:{salonId:string}) {
  const router=useRouter();
  const [draft,setDraft]=useState<UpdateSalonOperatingHoursInput|null>(null);
  const [allowed,setAllowed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;
    loadProfileOperatingHours(salonId).then(result=>{if(active){setMessage(result.error??"");setAllowed(result.canManage);if(result.settings)setDraft({timeZone:result.settings.timeZone,weeklyHours:result.settings.weeklyHours});}}).catch(()=>{if(active)setMessage("Could not load hours. Please try again.");});
    return()=>{active=false;};
  },[salonId,retry]);
  if(!draft)return <div><p role="status">{message||"Loading operating hours…"}</p>{message?<button type="button" onClick={()=>{setMessage("");setRetry(value=>value+1);}}>Retry</button>:null}</div>;
  return <form className={styles.form} onSubmit={async event=>{
    event.preventDefault();if(busy || !allowed)return;setBusy(true);setMessage("");
    try{const result=await saveProfileOperatingHours(salonId,draft);setMessage(result.error??"Operating hours saved.");if(result.ok)router.refresh();}
    catch{setMessage("Could not save hours. Please try again.");}finally{setBusy(false);}
  }}>
    <p className={styles.hint}>Hours shown on your salon profile. Booking availability is managed separately.</p>
    <label className={styles.timezone}>Timezone<input aria-label="Salon timezone" value={draft.timeZone} disabled={busy||!allowed} onChange={event=>setDraft({...draft,timeZone:event.target.value})} required/></label>
    <fieldset disabled={busy||!allowed} className={styles.days}>
      {days.map((day,dayOfWeek)=>{
        const intervals=draft.weeklyHours.map((window,index)=>({window,index})).filter(({window})=>window.dayOfWeek===dayOfWeek);
        return <div key={day} className={styles.day}><strong>{day}</strong><div>
          {intervals.length?intervals.map(({window,index})=><div className={styles.interval} key={index}>
            <input type="time" aria-label={`${day} opening time ${index+1}`} value={window.opensAtLocal.slice(0,5)} required onChange={event=>setDraft({...draft,weeklyHours:draft.weeklyHours.map((row,i)=>i===index?{...row,opensAtLocal:event.target.value}:row)})}/>
            <span>–</span>
            <input type="time" aria-label={`${day} closing time ${index+1}`} value={window.closesAtLocal.slice(0,5)} required onChange={event=>setDraft({...draft,weeklyHours:draft.weeklyHours.map((row,i)=>i===index?{...row,closesAtLocal:event.target.value}:row)})}/>
            <button type="button" aria-label={`Remove ${day} interval ${index+1}`} onClick={()=>setDraft({...draft,weeklyHours:draft.weeklyHours.filter((_,i)=>i!==index)})}>×</button>
          </div>):<span className={styles.hint}>Closed</span>}
          <button className={styles.add} type="button" onClick={()=>setDraft({...draft,weeklyHours:[...draft.weeklyHours,{dayOfWeek,opensAtLocal:"09:00",closesAtLocal:"17:00",sortOrder:intervals.length}]})}>{intervals.length?"add interval":"add hours"}</button>
        </div></div>;
      })}
    </fieldset>
    <p className={styles.hint}>Closing after midnight is supported. Holiday hours and temporary closures keep their existing overrides.</p>
    {!allowed?<p role="status">You can view hours. Editing requires salon settings permission.</p>:null}
    {message?<p role="status">{message}</p>:null}
    {allowed?<button className={styles.save} disabled={busy} type="submit">{busy?"Saving…":"Save hours"}</button>:null}
    <a className={styles.link} href="/salon-settings#operating-hours">Holiday hours & temporary closures</a>
  </form>;
}
