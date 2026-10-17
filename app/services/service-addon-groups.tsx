"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import type { ServiceOwnedAddOn } from "@/types/service";
import { useState } from "react";

export function ServiceAddOnGroups({items, disabled, onChange}: {
  items: ServiceOwnedAddOn[];
  disabled: boolean;
  onChange: (items: ServiceOwnedAddOn[]) => void;
}) {
  const t = useWorkspaceTranslation();
  const [editing, setEditing] = useState<number | null>(null);
  const patch = (index: number, value: Partial<ServiceOwnedAddOn>) =>
    onChange(items.map((item, i) => i === index ? {...item, ...value} : item));
  return <section className="service-editor__section service-addon-groups">
    <h3><WorkspaceText text="Booking add-ons" /></h3>
    <p><WorkspaceText text="Optional extras for this service. Extra time and price are added to the booking." /></p>
    {(["one", "many"] as const).map(group => <div className="service-addon-group" key={group}>
      <div className="service-editor__subheading"><div><h4><WorkspaceText text={group === "one" ? "Choose one" : "Choose multiple"} /></h4>
        <p><WorkspaceText text={group === "one" ? "Optional · choose up to one" : "Optional · choose several"} /></p></div>
        <button type="button" className="services-button services-button--secondary" disabled={disabled || items.length >= 40}
          onClick={() => {setEditing(items.length); onChange([...items, {name: "", group, basePrice: 0, durationMinutes: 10}]);}}>
          <WorkspaceText text="+ Add" /></button></div>
      {items.map((item,index) => item.group !== group ? null : <div className="service-addon-item" key={item.serviceId ?? `new-${index}`}>
        <div className="service-addon-summary"><div><strong>{item.name || t("New add-on")}</strong><span>+{item.durationMinutes} <WorkspaceText text="min" /> · +${item.basePrice.toFixed(2)}</span></div>
          <button type="button" className="services-button services-button--secondary" disabled={disabled} onClick={() => setEditing(editing === index ? null : index)}>
            <WorkspaceText text={editing === index ? "Done" : "Edit"} /></button></div>
        {editing === index ? <div className="service-editor__fields">
          <label className="services-field"><span><WorkspaceText text="Name" />:</span><input aria-label={t("Add-on name")} maxLength={120} disabled={disabled}
            value={item.name} onChange={event => patch(index,{name:event.target.value})} /></label>
          <label className="services-field"><span><WorkspaceText text="Extra time" />:</span><span className="services-number-field services-number-field--suffix"><input aria-label={t("Add-on extra time")}
            type="number" min={1} max={1440} step={1} disabled={disabled} value={item.durationMinutes} onChange={event => patch(index,{durationMinutes:Number(event.target.value)})} /><span><WorkspaceText text="min" /></span></span></label>
          <label className="services-field"><span><WorkspaceText text="Extra price" />:</span><span className="services-number-field"><span>$</span><input aria-label={t("Add-on extra price")}
            type="number" min={0} step="0.01" disabled={disabled} value={item.basePrice} onChange={event => patch(index,{basePrice:Number(event.target.value)})} /></span></label>
          <button type="button" className="services-button services-button--secondary" disabled={disabled} onClick={() => {onChange(items.filter((_,i) => i !== index));setEditing(null);}}><WorkspaceText text="Remove add-on" /></button>
        </div> : null}
      </div>)}
      {!items.some(item => item.group === group) ? <p><WorkspaceText text="No add-ons in this group." /></p> : null}
    </div>)}
  </section>;
}
