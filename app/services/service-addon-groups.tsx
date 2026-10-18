"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import type { ServiceOwnedAddOn } from "@/types/service";
import { useEffect, useRef, useState } from "react";

function AddOnNumberInput({value, onChange, label, placeholder, decimal, disabled}: {
  value: number; onChange: (value: number) => void; label: string; placeholder: string;
  decimal?: boolean; disabled: boolean;
}) {
  const [text,setText] = useState(Number.isFinite(value) ? String(value) : "");
  const emitted = useRef(value);
  useEffect(() => {
    if (!Object.is(value,emitted.current)) {
      emitted.current=value;
      setText(Number.isFinite(value) ? String(value) : "");
    }
  },[value]);
  return <input aria-label={label} placeholder={placeholder} disabled={disabled} type="text"
    inputMode={decimal ? "decimal" : "numeric"} value={text}
    onFocus={event => event.currentTarget.select()}
    onChange={event => {
      const next=event.target.value;
      if (!(decimal ? /^\d*(?:\.\d{0,2})?$/ : /^\d*$/).test(next)) return;
      setText(next);
      const number=next.trim() === "" || next === "." ? Number.NaN : Number(next);
      emitted.current=number;onChange(number);
    }} onBlur={() => {if(Number.isFinite(value))setText(String(value));}} />;
}

export function ServiceAddOnGroups({items, disabled, onChange}: {
  items: ServiceOwnedAddOn[];
  disabled: boolean;
  onChange: (items: ServiceOwnedAddOn[]) => void;
}) {
  const t = useWorkspaceTranslation();
  const [editing, setEditing] = useState<number | null>(null);
  const focusName = useRef<number | null>(null);
  const patch = (index: number, value: Partial<ServiceOwnedAddOn>) =>
    onChange(items.map((item, i) => i === index ? {...item, ...value} : item));
  return <section className="service-editor__section service-addon-groups">
    <h3><WorkspaceText text="Booking add-ons" /></h3>
    <p><WorkspaceText text="Optional extras for this service. Extra time and price are added to the booking." /></p>
    {(["one", "many"] as const).map(group => <div className="service-addon-group" key={group}>
      <div className="service-editor__subheading"><div><h4><WorkspaceText text={group === "one" ? "Choose one" : "Choose multiple"} /></h4>
        <p><WorkspaceText text={group === "one" ? "Optional · choose up to one" : "Optional · choose several"} /></p></div>
        <button type="button" className="services-button services-button--secondary" disabled={disabled || items.length >= 40}
          onClick={() => {focusName.current=items.length;setEditing(items.length); onChange([...items, {name: "", group, basePrice: Number.NaN, durationMinutes: Number.NaN}]);}}>
          <WorkspaceText text="+ Add" /></button></div>
      {items.map((item,index) => item.group !== group ? null : <div className="service-addon-item" key={item.serviceId ?? `new-${index}`}>
        <div className="service-addon-summary"><div><strong>{item.name || t("New add-on")}</strong><span>+{Number.isFinite(item.durationMinutes) ? item.durationMinutes : "—"} <WorkspaceText text="min" /> · +${Number.isFinite(item.basePrice) ? item.basePrice.toFixed(2) : "—"}</span></div>
          <button type="button" className="services-button services-button--secondary" disabled={disabled} onClick={() => setEditing(editing === index ? null : index)}>
            <WorkspaceText text={editing === index ? "Done" : "Edit"} /></button></div>
        {editing === index ? <div className="service-editor__fields">
          <label className="services-field"><span><WorkspaceText text="Name" />:</span><input aria-label={t("Add-on name")} maxLength={120} disabled={disabled} placeholder={t("e.g. Gel polish")}
            ref={node => {if(node && focusName.current === index){node.focus();focusName.current=null;}}}
            value={item.name} onChange={event => patch(index,{name:event.target.value})} /></label>
          <label className="services-field"><span><WorkspaceText text="Extra time" />:</span><span className="services-number-field services-number-field--suffix"><AddOnNumberInput label={t("Add-on extra time")}
            placeholder={t("e.g. 10")} disabled={disabled} value={item.durationMinutes} onChange={durationMinutes => patch(index,{durationMinutes})} /><span><WorkspaceText text="min" /></span></span></label>
          <label className="services-field"><span><WorkspaceText text="Extra price" />:</span><span className="services-number-field"><span>$</span><AddOnNumberInput label={t("Add-on extra price")}
            placeholder={t("e.g. 10.00")} decimal disabled={disabled} value={item.basePrice} onChange={basePrice => patch(index,{basePrice})} /></span></label>
          <button type="button" className="services-button services-button--secondary" disabled={disabled} onClick={() => {onChange(items.filter((_,i) => i !== index));setEditing(null);}}><WorkspaceText text="Remove add-on" /></button>
        </div> : null}
      </div>)}
      {!items.some(item => item.group === group) ? <p><WorkspaceText text="No add-ons in this group." /></p> : null}
    </div>)}
  </section>;
}
