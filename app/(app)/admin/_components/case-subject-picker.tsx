"use client";
import { useState } from "react";
import { EntityPicker } from "./entity-picker";
export function CaseSubjectPicker() {
  const [kind,setKind] = useState<""|"user"|"business"|"location">("");
  return <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2"><label className="grid gap-1 text-sm font-medium">Related record<select name="subject_type" value={kind} onChange={event=>setKind(event.target.value as typeof kind)} className="rounded-lg border border-zinc-300 px-3 py-2"><option value="">No related record</option><option value="user">User</option><option value="business">Business</option><option value="location">Location</option></select></label>{kind && <EntityPicker key={kind} kind={kind} name="subject_id" label="Select record" required/>}</div>;
}
