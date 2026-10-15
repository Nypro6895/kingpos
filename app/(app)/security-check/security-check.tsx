"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export function SecurityCheck() {
  const [challenge, setChallenge] = useState<{ id: string; image: string } | null>(null);
  const [answer, setAnswer] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(true);
  const [complete, setComplete] = useState(false);
  async function load() {
    setPending(true); setNotice(""); setAnswer("");
    try {
      const response = await fetch("/api/security/challenge", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setChallenge(result);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to load security check."); }
    finally { setPending(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/security/challenge", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!controller.signal.aborted) setChallenge(result);
      })
      .catch(error => { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Unable to load security check."); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, []);
  if (complete) return <div className="mt-6 grid gap-4"><p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900">Verified. You can now try your action again.</p><button onClick={() => history.back()} className="rounded-lg border p-3">Return to previous page</button><Link href="/explore" className="text-center underline">Explore</Link></div>;
  return <form className="mt-6 grid gap-4" onSubmit={async event => {
    event.preventDefault(); if (!challenge || pending) return;
    setPending(true); setNotice("");
    try {
      const response = await fetch("/api/security/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: challenge.id, answer }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setComplete(true);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to verify."); }
    finally { setPending(false); }
  }}>
    {/* This is a server-rendered raster challenge; its answer is never sent as text. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {challenge ? <img src={challenge.image} width={310} height={80} alt="Security challenge: six distorted characters" className="rounded-lg"/> : null}
    <label className="grid gap-2 text-sm">Characters in the image<input required minLength={6} maxLength={6} autoComplete="off" autoCapitalize="characters" value={answer} onChange={event => setAnswer(event.target.value)} className="rounded-lg border p-3"/></label>
    <button disabled={pending || !challenge} className="rounded-lg bg-zinc-950 p-3 text-white disabled:opacity-50">{pending ? "Please wait…" : "Verify"}</button>
    <button type="button" disabled={pending} onClick={() => void load()} className="text-sm underline">Get a new image</button>
    {notice ? <p role="alert" className="text-sm text-red-700">{notice}</p> : null}
    <Link href="/contact-support" className="text-sm text-zinc-500 underline">Need help completing the check? Contact support</Link>
  </form>;
}
