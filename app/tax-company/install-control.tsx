"use client";
import { useEffect, useState } from "react";
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export function TaxAppRuntime() {
  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/tax-company/sw.js", { scope: "/tax-company/" }).catch(() => {}); }, []);
  return null;
}
export function TaxAppInstallControl() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const displayChanged = () => setInstalled(display.matches);
    display.addEventListener("change", displayChanged);
    const ready = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); };
    const done = () => { setInstalled(true); setEvent(null); };
    window.addEventListener("beforeinstallprompt", ready); window.addEventListener("appinstalled", done);
    return () => { display.removeEventListener("change", displayChanged); window.removeEventListener("beforeinstallprompt", ready); window.removeEventListener("appinstalled", done); };
  }, []);
  return <div className="grid gap-3">{installed ? <p>Tax Company app is installed.</p> : event ? <button className="rounded-lg bg-zinc-950 p-3 text-white" onClick={async () => { await event.prompt(); if ((await event.userChoice).outcome === "accepted") setInstalled(true); setEvent(null); }}>Install Tax Company app</button> : <p>To install: on iPhone/iPad, open in Safari → Share → Add to Home Screen. On Android or desktop, open in Chrome/Edge and choose Install app from the browser menu.</p>}<p className="text-sm text-zinc-500">The app works online on phones and computers. Use the same personal Reylumi account on every device.</p></div>;
}
