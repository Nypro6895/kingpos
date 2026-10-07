'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

async function saveChoice(action: 'download' | 'later' | 'never') {
  const response = await fetch('/api/pos/windows-download', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action}) });
  if (!response.ok) throw new Error('Could not save your choice. Please try again.');
}

export function WindowsPosDownloadLinks({ href, onDownloaded }: { href:string; onDownloaded?:()=>void }) {
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null);
  useEffect(()=>{if(linkInput.current)linkInput.current.value=new URL(href,window.location.origin).href;},[href]);
  async function download() {
    setBusy(true); setMessage('');
    try {
      await saveChoice('download');
      const link = document.createElement('a'); link.href=href; link.download=''; document.body.append(link); link.click(); link.remove();
      setMessage('Download started. Automatic reminders are turned off.'); onDownloaded?.();
    } catch(error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function share() {
    const url = new URL(href,window.location.origin).href;
    try {
      if (navigator.share) await navigator.share({title:'Windows POS app',url});
      else { await navigator.clipboard.writeText(url); setMessage('Download link copied.'); }
    } catch(error) { if ((error as Error).name !== 'AbortError') setMessage('Could not share. Copy the download link below.'); }
  }
  return <div className="grid gap-3">
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={download} className="rounded-xl bg-zinc-950 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy?'Preparing…':'Download Windows app'}</button><button type="button" onClick={share} className="rounded-xl border border-zinc-300 px-4 py-3">Share link</button></div>
    <input ref={linkInput} readOnly aria-label="Windows app download link" defaultValue={href} onFocus={event=>event.target.select()} className="w-full rounded-lg border border-zinc-200 p-2 text-xs"/>
    {message?<p role="status" className="text-sm">{message}</p>:null}
  </div>;
}

export function WindowsPosDownloadPrompt({ authenticated }: { authenticated:boolean }) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [release,setRelease] = useState<{href:string;version:string;edition:'test'|'release'}|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [downloaded,setDownloaded] = useState(false);
  useEffect(()=>{
    if (!authenticated || pathname.startsWith('/pos/portable')) return;
    let cancelled=false;
    async function check() {
      try {
        const response = await fetch('/api/pos/windows-download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check',pos:pathname==='/pos'||pathname.startsWith('/pos/')})});
        if (!response.ok) return;
        const result = await response.json();
        if (!cancelled && result.show && result.release) { setDownloaded(false); setRelease(result.release); }
      } catch { /* Retry on the next navigation when connectivity returns. */ }
    }
    void check(); window.addEventListener('windows-pos:claim-approved',check);
    return ()=>{cancelled=true;window.removeEventListener('windows-pos:claim-approved',check);};
  },[authenticated,pathname]);
  useEffect(()=>{if(release && !dialog.current?.open)dialog.current?.showModal();},[release]);
  function close() { dialog.current?.close(); setRelease(null); setError(''); }
  async function choose(action:'later'|'never') {
    setBusy(true);setError('');
    try {await saveChoice(action);close();} catch(error){setError((error as Error).message);} finally{setBusy(false);}
  }
  return <dialog ref={dialog} aria-labelledby="windows-pos-title" onCancel={event=>{event.preventDefault();close();}} onClose={()=>setRelease(null)} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl bg-white p-6 text-zinc-950 shadow-2xl backdrop:bg-black/45">
    <div className="flex items-start justify-between gap-4"><h2 className="text-xl font-semibold" id="windows-pos-title">Use Windows POS at your salon</h2><button type="button" onClick={close} aria-label="Close download reminder" className="rounded-lg px-3 py-2">✕</button></div>
    <p className="my-4 text-sm text-zinc-600">Install the Windows app on your salon computer or touchscreen for a smoother, dedicated POS experience. You can always download it later in POS Settings → Install POS & customer display.</p>
    <details className="mb-5 rounded-xl border border-zinc-200 p-3"><summary className="cursor-pointer font-medium">Benefits & installation steps</summary><div className="mt-3 grid gap-3 text-sm text-zinc-600"><p>A dedicated POS window helps keep salon work separate from browser tabs. Saved tickets stay on this computer, and supported offline workflows can continue during an internet interruption. Keep this shared device protected with a Windows password and use a POS ID with only the permissions needed.</p><ol className="list-decimal space-y-2 pl-5"><li>Download the installer on your Windows computer or Windows touchscreen.</li><li>Open the downloaded .exe and follow the setup instructions. Verify the publisher before approving any Windows prompt.</li><li>Open the POS app and sign in with the salon’s POS ID and passcode from POS Settings.</li><li>On a touchscreen, use fullscreen and the touch keyboard when needed. Connect to the internet for sign-in and syncing.</li></ol><p>{release?.edition === "test" ? "Local test edition. Requires the configured salon server." : "Online edition. Internet is required for sign-in and syncing."}</p></div></details>
    {release?<WindowsPosDownloadLinks href={release.href} onDownloaded={()=>setDownloaded(true)}/>:null}
    {downloaded?<p className="mt-3 text-sm">You can close this message, or choose “Remind me later” to receive another reminder after your next sign-in.</p>:null}
    {error?<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>:null}
    <div className="mt-5 flex flex-wrap gap-3 text-sm"><button type="button" disabled={busy} onClick={close} className="rounded-xl border px-4 py-3">Close</button><button type="button" disabled={busy} onClick={()=>void choose('later')} className="rounded-xl border px-4 py-3">Remind me later</button><button type="button" disabled={busy} onClick={()=>void choose('never')} className="rounded-xl px-4 py-3 underline">Don’t remind me again</button></div>
  </dialog>;
}
