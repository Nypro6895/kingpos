"use client";
import { CustomerName } from "@/components/customer-name";
import { useEffect, useState, useRef } from "react";
import { posUserMessage } from "@/lib/pos-user-messages";
import { desktopDevice } from "@/lib/portable-device-storage";
import { cancelPortableOperation, canCancelPortableOperation, retryPortableOperation, listPortableOperations, PORTABLE_OPERATIONS_CHANGED, syncPortableOperations, type PortableOperation } from "@/lib/portable-operations";

export function PortableSyncIndicator({ scope }: { scope: string }) {
  const [offline, setOffline] = useState(false);
  const [connection, setConnection] = useState<'checking'|'online'|'offline'>('checking');
  useEffect(() => {
    let active=true, running=false;
    const check=async()=>{
      if(running)return;
      if(!navigator.onLine){if(active)setConnection('offline');return;}
      running=true;
      try{
        const response=await fetch('/api/pos/connection',{cache:'no-store',signal:AbortSignal.timeout(5000)});
        const result=response.ok?await response.json():null;
        if(active)setConnection(result?.available===true?'online':'offline');
      }catch{if(active)setConnection('offline');}
      finally{running=false;}
    };
    void check();const timer=setInterval(()=>void check(),15000);
    window.addEventListener('online',check);window.addEventListener('focus',check);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('online',check);window.removeEventListener('focus',check);};
  },[]);
  const [items, setItems] = useState<PortableOperation[]>([]);
  const [storageError, setStorageError] = useState(false);
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState<PortableOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const confirmation = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (cancelling) confirmation.current?.showModal();
    else confirmation.current?.close();
  }, [cancelling]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      setOffline(!navigator.onLine);
      void listPortableOperations(scope).then((rows) => { if (active) { setStorageError(false); setItems(rows.filter((r) => r.state !== "synced" && r.state !== "cancelled")); } }).catch(() => { if (active) setStorageError(true); });
    };
    const wake = () => { refresh(); void syncPortableOperations(scope).catch(() => {}); };
    const initial = setTimeout(wake, 0);
    const interval = setInterval(wake, 5000);
    window.addEventListener("online", wake); window.addEventListener("offline", refresh);
    window.addEventListener(PORTABLE_OPERATIONS_CHANGED, refresh);
    return () => {
      active = false; clearTimeout(initial); clearInterval(interval);
      window.removeEventListener("online", wake); window.removeEventListener("offline", refresh);
      window.removeEventListener(PORTABLE_OPERATIONS_CHANGED, refresh);
    };
  }, [scope]);
  const disconnected = offline || connection === "offline";
  const attention = storageError || items.some((item) => item.state === "attention");
  const label = storageError ? "Unable to save on this device" : disconnected ? "Offline" : attention ? "Not synced" : items.length ? "Syncing" : connection === "checking" ? "Connecting" : "Up to date";
  return <div className="relative" ref={root}>
    <button aria-label={label} title={label} type="button" onClick={() => setOpen(!open)}
      className={`grid h-10 w-10 place-items-center rounded-full ${attention ? "text-amber-600" : disconnected ? "text-zinc-400" : "text-emerald-700"}`}>
      <svg viewBox="0 0 24 24" className={`h-5 w-5 ${items.length && !disconnected && !attention ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        {disconnected ? <path d="M3 3l18 18M6 6a9 9 0 0 0-3 2m6-4a14 14 0 0 1 12 4M6 12a9 9 0 0 1 3-2m5 0a9 9 0 0 1 4 2M9 16a5 5 0 0 1 6 0m-3 4h.01" /> : attention ? <><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v1"/></> : items.length ? <><path d="M20 7a9 9 0 0 0-15-2L2 8m0-6v6h6M4 17a9 9 0 0 0 15 2l3-3m0 6v-6h-6"/></> : <path d="m5 12 4 4L19 6"/>}
      </svg>
    </button>
    {open ? <div className="absolute right-0 top-12 z-50 w-72 rounded-lg border bg-white p-4 text-sm shadow-lg">
      <p className="font-semibold">{label}</p>
      <p className="mt-1 text-zinc-500">{items.length ? `${items.length} saved on this device` : storageError ? "Device storage unavailable" : disconnected ? "Updates will resume automatically when connected." : connection === "checking" ? "Checking connection" : "All tickets uploaded"}</p>
      {items.filter((i) => i.state === "attention").map((i) => <div key={i.id} className="mt-3 border-t border-zinc-100 pt-3 text-amber-800">
        <p>{i.error === 'Assigned staff must be checked in and working.' ? "This ticket was not saved to the system because a staff member was not checked in." : `${({ receipt: "Ticket", attendance: "Staff check-in", booking: "Booking", visit: "Customer update" })[i.kind]}: ${posUserMessage(i.error ?? "Please check this item and try again.")}`}</p>
        {i.kind==='receipt'&&Array.isArray(i.payload.lines)?<ul className="mt-2 text-xs text-zinc-700">{i.payload.lines.map((line,index)=><li key={index}>{String(line.serviceLabel??'Service')} · ${Number(line.total??0).toFixed(2)}</li>)}</ul>:null}
        <p className="mt-1 text-xs text-zinc-500"><CustomerName name={String(i.payload.customerName || "")} /> · {new Date(i.occurredAt).toLocaleString()} · {i.id.slice(0, 8)}</p>
        <div className="mt-2 flex gap-2"><button disabled={busy} type="button" className="min-h-11 rounded-lg border px-3 shadow-sm transition hover:bg-amber-50 active:scale-95 disabled:opacity-50" onClick={() => { setBusy(true); setActionError(""); void retryPortableOperation(scope, i.id).catch(() => setActionError("Unable to try again. Please try once more.")).finally(() => setBusy(false)); }}>Try again</button>
        {canCancelPortableOperation(i) ? <button disabled={busy} type="button" className="min-h-11 rounded-lg border border-red-200 px-3 text-red-700 shadow-sm transition hover:bg-red-50 active:scale-95 disabled:opacity-50" onClick={() => { setActionError(""); setCancelling(i); setOpen(false); }}>Cancel {i.kind==='receipt'?'ticket':'change'}</button> : null}</div>
      </div>)}
      {actionError ? <p role="alert" className="mt-3 text-red-700">{actionError}</p> : null}
    </div> : null}
    <dialog ref={confirmation} aria-labelledby="cancel-ticket-title" onCancel={event => { if (busy) event.preventDefault(); else setCancelling(null); }} className="fixed inset-0 m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border-0 bg-white p-6 text-zinc-900 shadow-xl backdrop:bg-black/40">
      <h2 id="cancel-ticket-title" className="text-lg font-semibold">Cancel this {cancelling?.kind==='receipt'?'ticket':'change'}?</h2>
      <p className="mt-3 text-sm text-zinc-600">This item will not be uploaded. Its record will be kept on this device. Other tickets and staff changes will be kept.</p>
      {cancelling ? <p className="mt-3 text-sm font-medium"><CustomerName name={String(cancelling.payload.customerName || "")} /> · {new Date(cancelling.occurredAt).toLocaleString()} · {cancelling.id.slice(0, 8)}</p> : null}
      {actionError ? <p role="alert" className="mt-3 text-sm text-red-700">{actionError}</p> : null}
      <div className="mt-5 flex justify-end gap-3">
        <button autoFocus disabled={busy} type="button" onClick={() => setCancelling(null)} className="min-h-12 rounded-xl border px-5 font-semibold shadow-sm transition hover:bg-zinc-100 active:scale-95 disabled:opacity-50">Keep ticket</button>
        <button disabled={busy} type="button" className="min-h-12 rounded-xl bg-red-600 px-5 font-semibold text-white shadow-sm transition hover:bg-red-700 active:scale-95 disabled:opacity-50" onClick={() => {
          if (!cancelling) return;
          const device = desktopDevice();
          if (device && device.version < (cancelling.error==='Assigned staff must be checked in and working.'?2:3)) { setActionError("Install the latest KingPOS update to cancel this item. Your tickets will be kept."); return; }
          setBusy(true); setActionError("");
          void cancelPortableOperation(scope, cancelling.id).then(() => setCancelling(null)).catch(() => setActionError("Unable to cancel this ticket. It has been kept. Please try again.")).finally(() => setBusy(false));
        }}>{busy ? "Cancelling…" : "Cancel ticket"}</button>
      </div>
    </dialog>
  </div>;
}
