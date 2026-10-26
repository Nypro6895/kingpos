"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendAccountPhoneVerificationOtpAction, verifyAccountPhoneOtpAction } from "@/app/account/actions";
import { finishSignupPhoneAction, loadSignupHistoryAction, type PhoneHistoryProfile } from "./actions";

const button = "min-h-12 w-full rounded-full bg-brand-orange px-4 text-sm font-bold text-white disabled:opacity-50";
const input = "mt-2 min-h-12 w-full rounded-xl border border-border-subtle px-3 text-base text-text-primary";

export function SignupPhoneForm({ initialPhone, initiallyVerified, nextPath }: {
  initialPhone: string; initiallyVerified: boolean; nextPath: string;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState("");
  const [sentPhone, setSentPhone] = useState<string | null>(null);
  const [verified, setVerified] = useState(initiallyVerified);
  const [profiles, setProfiles] = useState<PhoneHistoryProfile[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [wait, setWait] = useState(0);
  const [busy, start] = useTransition();
  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => setWait(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  function run(action: () => Promise<void>) {
    setError("");
    start(async () => {
      try { await action(); }
      catch { setError("Please check your connection and try again."); }
    });
  }
  async function finish(ids: string[]) {
    const result = await finishSignupPhoneAction({ customerIds: ids, nextPath });
    if (result.error) { setError(result.error); return; }
    router.replace(result.redirectTo ?? "/activity");
    router.refresh();
  }
  async function loadHistory() {
    const result = await loadSignupHistoryAction();
    if (result.error) { setError(result.error); return; }
    const rows = result.profiles ?? [];
    if (!rows.some(row => !row.linked)) { await finish([]); return; }
    setProfiles(rows);
  }
  function send() { run(async () => {
    const result = await sendAccountPhoneVerificationOtpAction({ phone });
    if (result.error) { setError(result.error); return; }
    if (result.status === "already_verified") { setVerified(true); await loadHistory(); return; }
    setSentPhone(result.normalizedPhone ?? phone);
    setWait(result.resendAfterSeconds ?? 60);
    setNotice("Enter the code sent to your phone.");
  }); }
  function verify() { run(async () => {
    const result = await verifyAccountPhoneOtpAction({ phone: sentPhone, code });
    if (result.error) { setError(result.error); return; }
    setVerified(true);
    setNotice("Phone verified. Connecting your history…");
    await loadHistory();
  }); }
  const choices = profiles?.filter(row => !row.linked) ?? [];
  return <div className="mt-6 grid gap-4" aria-busy={busy}>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {profiles ? <>
      <div><h2 className="font-bold">Which profiles are yours?</h2>
        <p className="mt-1 text-sm text-text-secondary">This number has more than one profile. Select yours, or select several to combine their history in your account.</p></div>
      {choices.length > 1 ? <button type="button" disabled={busy} className="min-h-11 text-left text-sm font-bold text-brand-orange" onClick={() => setSelected(selected.length === choices.length ? [] : choices.map(row => row.id))}>{selected.length === choices.length ? "Clear selection" : "Select all my profiles"}</button> : null}
      <div className="grid max-h-[40dvh] gap-2 overflow-y-auto">
        {profiles.map(row => <label key={row.id} className="flex min-h-14 items-center gap-3 rounded-xl border border-border-subtle p-3">
          <input type="checkbox" disabled={busy || row.linked} checked={row.linked || selected.includes(row.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id))} />
          <span className="min-w-0 text-sm"><strong className="block break-words">{row.name}</strong><span className="break-words text-text-secondary">{row.salonName}{row.linked ? " · Connected" : ""}</span></span>
        </label>)}
      </div>
      <button className={button} type="button" disabled={busy || !selected.length} onClick={() => run(() => finish(selected))}>{busy ? "Connecting…" : "Connect selected history"}</button>
      <button className="min-h-11 text-sm font-semibold text-text-secondary" type="button" disabled={busy} onClick={() => run(() => finish([]))}>None of these profiles are mine</button>
    </> : verified ? <>
      <p className="text-sm text-text-secondary">Your phone is verified. Your matching salon history is ready to connect.</p>
      <button className={button} type="button" disabled={busy} onClick={() => run(loadHistory)}>{busy ? "Connecting…" : "Continue to my history"}</button>
    </> : <>
      <form className="grid gap-4" onSubmit={event => { event.preventDefault(); if (!busy) { if (sentPhone) verify(); else send(); } }}>
        <label className="text-sm font-bold">Phone number
          <input className={input} type="tel" autoComplete="tel" required value={phone} disabled={busy || Boolean(sentPhone)} onChange={event => setPhone(event.target.value)} />
        </label>
        {sentPhone ? <label className="text-sm font-bold">Verification code
          <input className={input} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
        </label> : null}
        <button className={button} disabled={busy} type="submit">{busy ? "Processing…" : sentPhone ? "Verify & connect history" : "Send verification code"}</button>
      </form>
      {sentPhone ? <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button className="min-h-11 font-bold text-brand-orange disabled:opacity-50" disabled={busy || wait > 0} type="button" onClick={send}>{wait ? `Resend in ${wait}s` : "Resend code"}</button>
        <button className="min-h-11 font-semibold text-text-secondary" disabled={busy} type="button" onClick={() => { setSentPhone(null); setCode(""); setNotice(""); }}>Change number</button>
      </div> : null}
    </>}
    {notice && !profiles ? <p role="status" className="text-sm text-text-secondary">{notice}</p> : null}
  </div>;
}
