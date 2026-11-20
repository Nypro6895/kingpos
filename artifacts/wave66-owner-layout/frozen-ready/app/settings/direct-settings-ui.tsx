"use client";
import { WorkspaceText } from "@/components/workspace-language";
import { createContext, useContext, useId, useRef, useState, type ReactNode } from "react";
import "./settings-controls.css";

import type { loadDirectSettings } from "./direct-settings-actions";
export type DirectData = Awaited<ReturnType<typeof loadDirectSettings>>;
export type ActionResult =
  | { ok: true; message?: string; inviteUrl?: string | null }
  | { ok: false; error?: string };
export const inputClass =
  "settings-input w-full";
export const buttonClass =
  "settings-button disabled:opacity-50";
export function Field({
  name,
  label,
  value,
  type = "text",
  required = false,
  min,
  max,
  step,
}: {
  name: string;
  label: string;
  value?: string | number | null;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <label className="settings-field">
      <WorkspaceText text={label} />
      <input
        name={name}
        className={inputClass}
        defaultValue={value ?? ""}
        type={type}
        required={required}
        min={min}
        max={max}
        step={step}
      />
    </label>
  );
}
export function Check({
  name,
  label,
  checked = false,
  required = false,
}: {
  name: string;
  label: string;
  checked?: boolean;
  required?: boolean;
}) {
  return (
    <label className={required?"settings-check":"settings-check settings-toggle-field"}>

      <input
        className="mt-1 size-4 shrink-0"
        name={name}
        type="checkbox"
        defaultChecked={checked}
        required={required}
      />
      <span className="settings-toggle-label"><WorkspaceText text={label} /></span>
      {!required?<span className="settings-toggle-track" aria-hidden="true"><span/></span>:null}
    </label>
  );
}
export function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <label className="settings-field">
      <WorkspaceText text={label} />
      <select aria-label={label} className={inputClass} name={name} defaultValue={value}>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            <WorkspaceText text={text} />
          </option>
        ))}
      </select>
    </label>
  );
}
export function InlineForm({
  children,
  save,
  onSaved,
  onCancel,
  label = "Save changes",
  danger = false,
  disabled = false,
  changed = false,
  className = "",
  actionOnly = false,
}: {
  children: ReactNode;
  save: (form: FormData) => Promise<ActionResult>;
  onSaved: () => void | Promise<void>;
  onCancel?: () => void;
  label?: string;
  danger?: boolean;
  disabled?: boolean;
  changed?: boolean;
  className?: string;
  actionOnly?: boolean;
}) {
  const finishEditing=useContext(SettingsEditingContext);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [refreshFailed, setRefreshFailed] = useState(false),
    [inviteUrl, setInviteUrl] = useState("");
  const lock = useRef(false),
    formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      aria-busy={busy}
      className={`settings-inline-form grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 ${actionOnly?"settings-action-form":""} ${className}`}
      onChange={() => { setDirty(true); setMessage(""); setError(""); }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (lock.current || disabled) return;
        lock.current = true;
        setBusy(true);
        setError("");
        setMessage("");
        setInviteUrl("");
        setRefreshFailed(false);
        const form = new FormData(event.currentTarget);
        try {
          const result = await save(form);
          if (!result.ok) {
            setError(
              result.error ?? "Could not save. Your changes are still here.",
            );
            return;
          }
          setMessage(result.message ?? "Saved.");
          setDirty(false);
          setInviteUrl(
            result.inviteUrl
              ? new URL(result.inviteUrl, window.location.origin).toString()
              : "",
          );
          try {
            await onSaved();
            if(!result.inviteUrl)finishEditing?.(true);
          } catch {
            setRefreshFailed(true);
          }
        } catch (e) {
          setError(
            e instanceof TypeError
              ? "Could not connect. Your changes are still here. Try saving again."
              : e instanceof Error
              ? e.message
              : "Could not save. Your changes are still here.",
          );
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="grid gap-3">
        {children}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          <WorkspaceText text={error} />
        </p>
      )}
      {message && !dirty && !changed && (
        <p role="status" className="text-sm text-emerald-700">
          <WorkspaceText text={message} />
        </p>
      )}
      {refreshFailed && <div role="status" className="grid gap-2 text-sm text-amber-800">
        <p><WorkspaceText text="Saved, but the latest values could not be loaded. Retry loading without saving again." /></p>
        {dirty || changed ? <p><WorkspaceText text="You have new edits. Save or cancel them before reloading saved values." /></p> : null}
        <button type="button" className={`${buttonClass} w-fit`} disabled={busy || dirty || changed} onClick={async () => {
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          try { await onSaved(); setRefreshFailed(false); } catch { /* Keep the retry and all drafts. */ }
          finally { lock.current = false; setBusy(false); }
        }}><WorkspaceText text="Reload saved values" /></button>
      </div>}
      {inviteUrl && (
        <label className="settings-field-row grid gap-1 text-sm">
          <WorkspaceText text="Invitation link" />
          <input
            className={inputClass}
            readOnly
            value={inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      )}
      <div className="settings-form-actions flex gap-2">
        {!actionOnly&&(dirty||changed)?<p role="status"><WorkspaceText text="Unsaved changes" /></p>:null}
        <button
          disabled={busy || disabled}
          className={`${buttonClass} ${danger ? "settings-danger-button" : "settings-primary-button"}`}
        >
          <WorkspaceText text={busy ? "Processing…" : label} />
        </button>
        {!actionOnly?<button
          type="button"
          className={buttonClass+" settings-cancel-button"}
          disabled={busy || disabled}
          onClick={() => {
            formRef.current?.reset();
            setDirty(false);
            onCancel?.();
            finishEditing?.();
            setInviteUrl("");
            setError("");
            setMessage("");
            setRefreshFailed(false);
          }}
        >
          <WorkspaceText text="Cancel" />
        </button>:null}
      </div>
    </form>
  );
}
export const text = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
export const number = (form: FormData, key: string) => Number(text(form, key));
export const checked = (form: FormData, key: string) => form.get(key) === "on";

export function SettingsFieldGroup({title,description,children}:{title:string;description?:string;children:ReactNode}) {
  return <fieldset className="settings-field-group"><legend><WorkspaceText text={title}/></legend><div className="settings-field-group-content">{description?<p className="settings-field-group-description"><WorkspaceText text={description}/></p>:null}{children}</div></fieldset>;
}

export function SettingsSwitch({label,description,checked,disabled,onChange}:{label:string;description?:string;checked:boolean;disabled?:boolean;onChange:()=>void}) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={onChange} className="settings-switch"><span className="settings-switch-copy"><span className="settings-switch-title"><WorkspaceText text={label}/></span>{description?<span className="settings-switch-description"><WorkspaceText text={description}/></span>:null}</span><span aria-hidden="true" className="settings-switch-track"><span className="settings-switch-thumb"/></span></button>;
}

const SettingsEditingContext=createContext<((saved?:boolean)=>void)|null>(null);
export function SettingsEditSection({title,summary,preview,children,action="Edit",danger=false,heading,closeOnSave=true}:{closeOnSave?:boolean;heading?:ReactNode;title:string;summary?:string;preview?:ReactNode;children:ReactNode;action?:string;danger?:boolean}){
 const [open,setOpen]=useState(false),[mounted,setMounted]=useState(false),[saved,setSaved]=useState(false);const id=useId();
 const finish=(success=false)=>{setSaved(success);setOpen(false);setMounted(false);};
 return <section className={"settings-edit-section"+(danger?" settings-edit-danger":"")} aria-label={title}>
  <header className="settings-section-heading"><div>{heading||<h3><WorkspaceText text={title}/></h3>}{summary?<p><WorkspaceText text={summary}/></p>:null}</div><button type="button" className="settings-button" aria-expanded={open} aria-controls={id} onClick={()=>{setSaved(false);setMounted(true);setOpen(v=>!v);}}><WorkspaceText text={open?"Close":action}/></button></header>
  {!open&&preview?<div className="settings-section-preview">{preview}</div>:null}
  {saved?<p className="settings-section-saved" role="status"><WorkspaceText text="Saved."/></p>:null}
  <div id={id} hidden={!open}>{mounted?<SettingsEditingContext.Provider value={closeOnSave?finish:null}>{children}</SettingsEditingContext.Provider>:null}</div>
 </section>;
}
export function SettingsReadRow({label,value}:{label:string;value:ReactNode}){return <div className="settings-read-row"><span><WorkspaceText text={label}/></span><div>{value===null||value===undefined||value===""?"—":value}</div></div>;}
export function SettingsIdentity({name,subtitle,imageUrl}:{name:string;subtitle?:string;imageUrl?:string|null}){return <div className="settings-identity"><span className="settings-identity-avatar">{imageUrl?
 // eslint-disable-next-line @next/next/no-img-element
 <img src={imageUrl} alt=""/>:name.split(/\s+/).slice(0,2).map(n=>n[0]).join("")}</span><div><strong>{name}</strong>{subtitle?<small>{subtitle}</small>:null}</div></div>;}

