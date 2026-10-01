"use client";
import { DesktopUpdate } from "./desktop-update";
import { useEffect, useState } from "react";
import { desktopDevice } from "@/lib/portable-device-storage";
export function DesktopTools() {
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAvailable(!!desktopDevice()?.display), 0);
    const lock = () => { void desktopDevice()?.display?.pair(null); };
    window.addEventListener("kingpos:portable-lock", lock);
    return () => { clearTimeout(timer); window.removeEventListener("kingpos:portable-lock", lock); };
  }, []);
  if (!available) return null;
  const button = "grid h-10 w-10 shrink-0 place-items-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 active:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-emerald-700";
  return <>
    <DesktopUpdate />
    <button type="button" aria-label="Open customer display" title="Customer display" className={button} onClick={() => {
      setError(""); void desktopDevice()?.display?.open().catch(() => setError("Connect once to prepare the customer screen, then try again."));
    }}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5m-4 0h8"/></svg></button>
    <button type="button" aria-label="App menu" title="App menu" className={button} onClick={() => desktopDevice()?.windowControls?.menu()}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
    {error && <button type="button" onClick={() => setError("")} className="absolute right-3 top-full mt-2 max-w-xs rounded-xl border bg-white p-3 text-left text-sm shadow-lg" role="alert">{error}</button>}
  </>;
}
