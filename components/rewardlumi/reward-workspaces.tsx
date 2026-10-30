"use client";
import Link from "next/link";
import { RewardActivity } from "./reward-activity";
import { useEffect, useMemo, useState } from "react";
import { rewardTransport } from "@/lib/rewardlumi-client";
import { defaultRewardProgram, rewardMoney, type RewardProgram, type RewardReply, type RewardTransport, type RewardReport } from "@/types/rewardlumi";
import styles from "./rewardlumi.module.css";

export function RewardOwner({ transport }: { transport?: RewardTransport }) {
  const send = useMemo(() => transport ?? rewardTransport("owner"), [transport]);
  const reportTransport = useMemo(() => transport ? async (day?: string) => await send("report", { day }) as unknown as RewardReport : undefined, [transport, send]);
  const [program, setProgram] = useState<RewardProgram>(defaultRewardProgram);
  const [stats, setStats] = useState<RewardReply>({});
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  useEffect(() => { let alive = true; send("load").then(result => { if (alive) { setProgram(result.program ?? defaultRewardProgram); setStats(result); setLoaded(true); } }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [send]);
  function edit(patch: Partial<RewardProgram>) { setProgram(value => ({ ...value, ...patch })); setSaved(false); }
  async function save() {
    setBusy(true); setError("");
    try { const result = await send("save", { program }); setProgram(result.program ?? program); setStats(result); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  }
  async function accept(id: string) {
    setBusy(true); setError("");
    try { const result = await send("accept", { id }); setStats(old => ({ ...old, ...result })); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not join."); }
    finally { setBusy(false); }
  }
  const fields: { key: "spendCents" | "spendPoints" | "welcomePoints" | "firstBookingPoints" | "visitPoints" | "conversionPoints"; title: string }[] = [
    { key: "spendCents", title: "Spend threshold ($)" }, { key: "spendPoints", title: "Points per threshold" }, { key: "welcomePoints", title: "Welcome points" },
    { key: "firstBookingPoints", title: "First completed, paid booking" }, { key: "visitPoints", title: "Per completed, paid visit" }, { key: "conversionPoints", title: "Paid booking from Before & After" },
  ];
  return <main className={styles.page} data-reward-owner><h1>Reward System</h1><p className={styles.muted}>Your salon’s loyalty rules and customer rewards.</p>
    {stats.invitations?.map(invite => <section className={styles.panel} key={invite.id}><h2>Grow with customer rewards</h2><p>Reylumi has prepared suggested earning rules for your salon. Review them and choose the rewards you want to provide.</p><div className={styles.actions}><button disabled={busy} onClick={() => edit({ ...invite.template, enabled: program.enabled })}>Review suggested rules</button><button disabled={busy || invite.accepted} onClick={() => void accept(invite.id)}>{invite.accepted ? "Joined" : "Join rewards promotion"}</button></div><p className={styles.muted}>Joining does not enable or change your rules. Confirm & save below to activate.</p></section>)}
    <section className={styles.panel}><h2>Program overview</h2><div className={styles.summary}><span><strong>{stats.members ?? 0}</strong>Members</span><span><strong>{stats.pendingConversions ?? 0}</strong>Bookings pending</span><span><strong>{stats.earnedConversions ?? 0}</strong>Bookings rewarded</span></div>
      <label>Enable new earning<input type="checkbox" checked={program.enabled} disabled={!loaded || busy} onChange={e => edit({ enabled: e.target.checked })} /></label>
      <label>Participate in Rewards nearby<input type="checkbox" checked={program.nearby} disabled={!loaded || busy} onChange={e => edit({ nearby: e.target.checked })} /></label>
      <p className={styles.muted}>Existing confirmed rewards remain usable when new earning is paused. Advertiser remains separate.</p>
    </section>
    <section className={styles.panel}><h2>Earning rules</h2>{fields.map(field => <label key={field.key}><span>{field.title}</span><input aria-label={field.title} type="number" min={field.key === "spendCents" ? 1 : 0} step={field.key === "spendCents" ? "0.01" : "1"} max="100000" value={field.key === "spendCents" ? program[field.key] / 100 : program[field.key]} disabled={!loaded || busy} onChange={e => edit({ [field.key]: field.key === "spendCents" ? Math.round(Number(e.target.value) * 100) : Number(e.target.value) })} /></label>)}
      <p className={styles.notice}>Before & After: the author receives pending points when someone books from the post. Points become available only after the guest completes the visit and pays in full. Posting alone earns no points.</p>
    </section>
    <section className={styles.panel}><h2>Reward catalog</h2><p className={styles.muted}>Defaults are editable. Your salon provides these rewards.</p>
      {program.offers.map((offer, index) => <fieldset className={styles.offer} key={offer.id}><legend>Reward {index + 1}</legend>
        <label>Title<input aria-label={`Reward ${index + 1} title`} maxLength={100} value={offer.title} onChange={e => edit({ offers: program.offers.map((o, i) => i === index ? { ...o, title: e.target.value } : o) })} /></label>
        {([['points', 'Points required'], ['valueCents', 'Discount value ($)'], ['minimumCents', 'Minimum services ($)']] as const).map(([key, title]) => <label key={key}>{title}<input type="number" min={key === "minimumCents" ? 0 : 1} step={key === "points" ? "1" : "0.01"} aria-label={`Reward ${index + 1} ${title}`} value={key === "points" ? offer[key] : offer[key] / 100} onChange={e => edit({ offers: program.offers.map((o, i) => i === index ? { ...o, [key]: key === "points" ? Number(e.target.value) : Math.round(Number(e.target.value) * 100) } : o) })} /></label>)}
        <label>Specific service (optional)<select value={offer.serviceId ?? ""} onChange={e => edit({ offers: program.offers.map((o, i) => i === index ? { ...o, serviceId: e.target.value || null } : o) })}><option value="">Any eligible services</option>{stats.services?.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        <button onClick={() => edit({ offers: program.offers.filter((_, i) => i !== index) })}>Remove reward</button>
      </fieldset>)}
      <button disabled={program.offers.length >= 20} onClick={() => edit({ offers: [...program.offers, { id: crypto.randomUUID(), title: "New reward", points: 100, valueCents: 500, minimumCents: 4000 }] })}>Add reward</button>
    </section>
    <section className={styles.panel}><h2>At the salon</h2><p>Check in or scan once → choose a reward on personal or the customer screen → customer confirms → POS applies it at payment.</p><p className={styles.muted}>Rewards reduce service totals. Gift cards pay the remaining balance. They have separate histories.</p><p className={styles.notice}>Confirming saves these terms for future qualifying activity. Existing requests retain their selected reward.</p>
      <button className={styles.primary} disabled={!loaded || busy} onClick={() => void save()}>{busy ? "Saving…" : "Confirm & save"}</button>
      {saved && <p role="status" className={styles.status}>Reward System saved.</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
    </section><RewardActivity transport={reportTransport} /></main>;
}

export function RewardWallet({ transport }: { transport?: RewardTransport }) {
  const send = useMemo(() => transport ?? rewardTransport("personal"), [transport]);
  const [data, setData] = useState<RewardReply | null>(null), [error, setError] = useState("");
  useEffect(() => { let alive = true; const load = () => send("wallet").then(d => { if (alive) { setData(d); setError(""); } }).catch(e => { if (alive) setError(e.message); }); void load(); const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000); return () => { alive = false; clearInterval(t); }; }, [send]);
  return <main className={styles.page} data-reward-wallet><h1>My Rewards</h1><p className={styles.muted}>Your points and rewards at each salon.</p>{error && <p role="alert" className={styles.error}>{error}</p>}
    {!data && !error && <p>Loading rewards…</p>}{data?.cards?.length === 0 && <section className={styles.panel}><h2>Your salon rewards will appear here</h2><p>Check in at a participating salon with your linked personal account.</p><Link href="/explore">Explore salons</Link></section>}
    {data?.cards?.map(card => <section className={styles.panel} key={card.salonId}><h2>{card.salonName}</h2><div className={styles.summary}><span><strong>{card.available}</strong>Available</span><span><strong>{card.pending}</strong>Pending</span>{card.reserved > 0 && <span><strong>{card.reserved}</strong>Reserved</span>}</div>
      {card.offers.map(offer => <div className={styles.row} key={offer.id}><span>{offer.title}<small className={styles.muted}> · minimum {rewardMoney(offer.minimumCents)}</small></span><strong>{offer.points} pts</strong></div>)}
      <Link href="/qr" className={styles.primary}>Use during your visit</Link>
      <details><summary>Ways to earn</summary><p>Every {rewardMoney(card.program?.spendCents ?? 2000)} → {card.program?.spendPoints ?? 20} points.</p><p>Bookings from your Before & After → {card.program?.conversionPoints ?? 30} points after completed, paid visits.</p><p className={styles.muted}>Pending points cannot be spent. Posting or sharing alone earns no points.</p></details>
      <details><summary>Point history</summary>{card.history?.map(row => <div className={styles.row} key={row.id}><span>{row.reason}<br /><small className={styles.muted}>{new Date(row.at).toLocaleDateString()}</small></span><strong>{row.delta > 0 ? "+" : ""}{row.delta}</strong></div>)}</details>
    </section>)}</main>;
}
