"use client";
import { WorkspaceText } from "@/components/workspace-language";
import { useState } from "react";
import { downloadPayrollData } from "./data-download-actions";

export function DataDownloadPanel({ salonId, startDate, endDate }: { salonId: string; startDate: string; endDate: string }) {
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);
  const [categories, setCategories] = useState(["financial", "staff", "customers"]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<{ name: string; csv: string }[]>([]);
  return <section id="download" className="rounded-xl border border-zinc-200 bg-white p-5" aria-labelledby="download-title">
    <h2 id="download-title" className="text-lg font-semibold"><WorkspaceText text="Download" /></h2>
    <form className="mt-4 flex flex-wrap items-end gap-4" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setMessage(""); setFiles([]);
      try {
        const result = await downloadPayrollData({ salonId, start, end, categories });
        if (result.error) setMessage(result.error);
        else { setFiles((result.files ?? []).map(file=>({name:file.name,csv:""}))); setMessage("Each download fetches current data when clicked."); }
      } catch { setMessage("Download failed. Please try again."); }
      finally { setBusy(false); }
    }}>
      <label className="grid gap-1 text-sm"><WorkspaceText text="From" /><input className="min-h-11 rounded-md border p-2" type="date" required value={start} onChange={event => { setStart(event.target.value); setFiles([]); setMessage(""); }} /></label>
      <label className="grid gap-1 text-sm"><WorkspaceText text="To" /><input className="min-h-11 rounded-md border p-2" type="date" required min={start} value={end} onChange={event => { setEnd(event.target.value); setFiles([]); setMessage(""); }} /></label>
      <fieldset className="flex flex-wrap gap-4"><legend className="mb-2 text-sm font-medium"><WorkspaceText text="Include" /></legend>{[ ["financial", "Salon financial"], ["staff", "Staff income"], ["customers", "Customers (created in range, UTC)"] ].map(([id, label]) => <label key={id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={categories.includes(id)} onChange={event => { setFiles([]); setCategories(event.target.checked ? [...categories, id] : categories.filter(value => value !== id)); }} /><WorkspaceText text={label} /></label>)}</fieldset>
      <button className="min-h-11 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-40" disabled={busy || !categories.length}>{busy ? "Preparing…" : <WorkspaceText text="Prepare downloads" />}</button>
    </form>
    {message && <p role="status" className="mt-3 text-sm"><WorkspaceText text={message} /></p>}
    {files.length > 0 && <div className="mt-2 flex flex-wrap gap-3">{files.map(file => <button disabled={busy} key={file.name} className="min-h-11 rounded-md border px-3 text-sm" onClick={async () => {
      setBusy(true);setMessage("");
      try {
        const result=await downloadPayrollData({salonId,start,end,categories:[file.name.split("-")[1]]});
        if(result.error)throw new Error(result.error);
        const current=result.files?.[0];if(!current)throw new Error("Current data could not be downloaded.");
        const url = URL.createObjectURL(new Blob([current.csv], { type: "text/csv;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = current.name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }catch(error){setMessage(error instanceof Error?error.message:"Download failed. Please retry.");}
      finally{setBusy(false);}
    }}><WorkspaceText text="Download" /> {file.name.split("-")[1]} <WorkspaceText text="CSV" /></button>)}</div>}
  </section>;
}
