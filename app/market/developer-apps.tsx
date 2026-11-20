"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {publicScopeLabels} from "@/lib/market-platform/published-contract";
import { WorkspaceText } from "@/components/workspace-language";
import { ownerAppAction, type OwnerAppActionState } from "./developer-app-actions";
import type { OwnerMarketState, OwnerVersion, OwnerInstallation, OwnerMarketplace } from "@/types/market-platform-owner";
import styles from "./market.module.css";
import appStyles from "./developer-apps.module.css";
import { OwnerVersionChange } from "./version-change";
import { compareOwnerVersions, ownerAppStatus } from "@/lib/market-platform/owner-app-status";
import { AppStatus } from "./app-status";

const initial: OwnerAppActionState = { ok: false, message: "" };
function AppForm({ operation, salon, label, children, disabled = false, requiresConsent = false, onConfirmed, onCancel }: { onCancel?: () => void; onConfirmed?: (market:OwnerMarketplace)=>void; operation: string; salon: string; label: string; children?: ReactNode; disabled?: boolean; requiresConsent?: boolean }) {
  const [state, action, pending] = useActionState(ownerAppAction, initial);
  const [consentedFor, setConsentedFor] = useState<OwnerAppActionState | null>(null);
  const consented = consentedFor === state;
  useEffect(() => { if (state.ok) { if(state.market) onConfirmed?.(state.market);window.dispatchEvent(new Event("reylumi:market-changed")); } }, [state,onConfirmed]);
  return <form action={action} className={appStyles.form} aria-busy={pending} onSubmit={event => { if (pending || state.uncertain) event.preventDefault(); }}>
    <input type="hidden" name="operation" value={operation} /><input type="hidden" name="salon" value={salon} />{children}
    {requiresConsent && <label className={appStyles.consent}><input name="consent" type="checkbox" value="yes" required checked={consented} onChange={event => setConsentedFor(event.target.checked ? state : null)} /><WorkspaceText text="I approve this version and its listed access for my current salon." /></label>}
    <button className={styles.primary} disabled={pending || state.uncertain || disabled || (requiresConsent && !consented)}><WorkspaceText text={pending ? "Updating…" : label} /></button>
    {state.message && <p role={state.ok ? "status" : "alert"}><WorkspaceText text={state.message} /></p>}
    {state.uncertain && <button className={appStyles.recovery} type="button" onClick={() => window.location.reload()}><WorkspaceText text="Reload Market to check the result" /></button>}
    {onCancel && <button type="button" className={appStyles.recovery} disabled={pending || state.uncertain} onClick={onCancel}><WorkspaceText text="Keep this app" /></button>}
    {state.checkoutUrl && <a href={state.checkoutUrl}><WorkspaceText text="Continue to test Checkout" /></a>}
  </form>;
}
const compare = compareOwnerVersions;
function RemoveApp({installation, salon, onConfirmed}: {installation: OwnerInstallation; salon: string; onConfirmed?: (market:OwnerMarketplace)=>void}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) return <button type="button" className={appStyles.recovery} onClick={() => setConfirming(true)}><WorkspaceText text="Remove plugin and revoke connection" /></button>;
  return <section className={appStyles.removeConfirmation} aria-label="Confirm plugin removal">
    <p><WorkspaceText text="Removing this app revokes its connection for this salon. It does not cancel a purchase, issue a refund or erase copies already received by the developer." /></p>
    <AppForm onConfirmed={onConfirmed} salon={salon} operation="revoke" label="Confirm removal" onCancel={() => setConfirming(false)}><input type="hidden" name="installation" value={installation.id} /></AppForm>
  </section>;
}
export function developerAppCount(state: OwnerMarketState | undefined, installedOnly = false, query = "", category = "All features") {
  if (state?.status !== "ready") return 0;
  if (!["All features", "Operations"].includes(category)) return 0;
  const needle=query.trim().toLowerCase();
  const ids=new Set(state.data.catalog.filter(v => `${v.manifest.name} ${v.manifest.description} ${v.publisher}`.toLowerCase().includes(needle) && (!installedOnly || state.data.installations.some(i => i.appId===v.app_id && i.state==="active"))).map(v=>v.app_id));
  if(installedOnly && "unavailable developer app".includes(needle))for(const i of state.data.installations)if(i.state==="active"&&!state.data.catalog.some(v=>v.app_id===i.appId))ids.add(i.appId);
  return ids.size;
}
export function DeveloperAppCards({ state, query, category, view, onConfirmed }: { onConfirmed?: (market:OwnerMarketplace)=>void; state?: OwnerMarketState; query: string; category: string; view: "discover" | "my-apps" }) {
  if (!state || state.status === "disabled") return null;
  if (state.status !== "ready") return <p className={styles.previewNote}>{state.status === "select-salon" ? <WorkspaceText text="Choose an active salon in your Owner workspace to manage developer apps." /> : <WorkspaceText text="Developer apps could not be loaded. Please refresh Market." />}</p>;
  return <OwnerDeveloperApps key={state.data.salonId} state={state} query={query} category={category} view={view} onConfirmed={onConfirmed} />;
}
function OwnerDeveloperApps({ state, query, category, view, onConfirmed }: {onConfirmed?: (market:OwnerMarketplace)=>void; state: Extract<OwnerMarketState, { status: "ready" }>; query: string; category: string; view: "discover" | "my-apps" }) {
  const { data } = state;
  const [selectedApp, setSelectedApp] = useState<string | null>(null), [chosenId, setChosenId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const groups = new Map<string, OwnerVersion[]>();
  for (const version of data.catalog) groups.set(version.app_id, [...(groups.get(version.app_id) ?? []), version].sort(compare));
  const selectedVersions = selectedApp ? groups.get(selectedApp) ?? [] : [];
  const selected = selectedVersions.find(v => v.id === chosenId) ?? selectedVersions[0];
  const installed = data.installations.find(i => i.appId === selectedApp && i.state === "active");
  const status = selected ? ownerAppStatus(selected, installed, data.catalog) : null;
  useEffect(() => { if (selected && !dialog.current?.open) dialog.current?.showModal();if (!selected && dialog.current?.open) dialog.current?.close(); }, [selected]);
  const close = () => { setSelectedApp(null);setChosenId(null); };
  const visible = [...groups.entries()].filter(([app, versions]) => {
    const v = versions[0], match = `${v.manifest.name} ${v.manifest.description} ${v.publisher}`.toLowerCase().includes(query.trim().toLowerCase());
    return match && ["All features", "Operations"].includes(category) && (view === "discover" || data.installations.some(i => i.appId === app && i.state === "active"));
  });
  const revoke = (i: OwnerInstallation) => <RemoveApp key={"revoke:" + i.id} installation={i} salon={data.salonId} onConfirmed={onConfirmed} />;
  return <><p><Link href="/market/data"><WorkspaceText text="Manage data shared with plugins" /></Link></p>{visible.map(([app, versions]) => {
    const current = data.installations.find(i => i.appId === app && i.state === "active");
    const installedVersion = current && versions.find(v => v.id === current.versionId);
    const v = view === "my-apps" && installedVersion ? installedVersion : versions[0];
    const cardStatus = ownerAppStatus(v, current, data.catalog);
    const select = (id: string) => { setSelectedApp(app); setChosenId(id); };
    return <article className={styles.card} key={app} data-developer-app={app}>
      <div className={styles.cardTop}><span aria-hidden="true" className={appStyles.icon}>↗</span><span className={styles.category}><WorkspaceText text="Developer app" /></span></div>
      <h3><button onClick={() => select(v.id)}>{v.manifest.name}</button></h3>
      <span className={styles.publisher}><WorkspaceText text="By" /> {v.publisher}</span><p>{v.manifest.description}</p>
      {installedVersion && <p className={appStyles.installedVersion}><WorkspaceText text="Installed version" />: {installedVersion.version}</p>}
      <div className={styles.priceLine}><strong>{v.manifest.price.amountCents ? "$" + (v.manifest.price.amountCents/100).toFixed(2) : <WorkspaceText text="Free" />}</strong><span><WorkspaceText text="Per salon · USD · this version" /></span></div>
      <AppStatus status={cardStatus} />
      <div className={appStyles.cardActions}>
        <button onClick={() => select(installedVersion?.id ?? v.id)}><WorkspaceText text={cardStatus.action} /></button>
        {cardStatus.update && <button onClick={() => select(cardStatus.update!.id)}><WorkspaceText text="Review update" /> · {cardStatus.update.version}</button>}
      </div>
    </article>;
  })}
    {view === "my-apps" && ["All features","Operations"].includes(category) && "unavailable developer app".includes(query.trim().toLowerCase()) && data.installations.filter(i => i.state === "active" && !groups.has(i.appId)).map(i => <article key={i.id} className={styles.card}><h3><WorkspaceText text="Unavailable developer app" /></h3><p><WorkspaceText text="This app is no longer available. Its connection is blocked; you can remove it from this salon." /></p>{revoke(i)}</article>)}
    <dialog ref={dialog} className={`${styles.dialog} ${styles.featureDialog}`} onCancel={close} onClose={close} aria-labelledby="developer-app-title"><button className={styles.close} aria-label="Close developer app" onClick={close}>×</button>{selected && <><span className={styles.eyebrow}><WorkspaceText text="REVIEWED DEVELOPER APP" /></span><h2 id="developer-app-title">{selected.manifest.name}</h2><p><WorkspaceText text="By" /> {selected.publisher}</p><p className={appStyles.salon}><WorkspaceText text="Your current salon" />: <strong>{data.salonName}</strong></p><p>{selected.manifest.description}</p><p><WorkspaceText text="This app opens on the developer's website. Reylumi shares only the permissions you approve for this salon." /></p>
      <p><WorkspaceText text="The publisher name and website are developer declarations. Manifest review does not verify domain ownership or certify the hosted code." /></p><p className={appStyles.launchAddress}><WorkspaceText text="Opens at" /> <code>{selected.manifest.launchUrl}</code></p>
      {status && <AppStatus status={status} />}
      <label className={appStyles.label}><WorkspaceText text="Version" /><select aria-label="Developer app version" value={selected.id} onChange={e => setChosenId(e.target.value)}>{selectedVersions.map(v => <option key={v.id} value={v.id}>{v.version}{installed?.versionId === v.id ? " · installed" : ""}</option>)}</select></label>
      <OwnerVersionChange selected={selected} installed={installed} catalog={data.catalog} />
      <h3><WorkspaceText text="Access needed" /></h3><ul>{selected.manifest.scopes.length ? selected.manifest.scopes.map(s => <li key={s}><WorkspaceText text={publicScopeLabels[s] ?? s} /></li>) : <li><WorkspaceText text="No salon data access" /></li>}</ul><p><a href={selected.manifest.privacyUrl} target="_blank" rel="noopener noreferrer"><WorkspaceText text="Privacy policy" /></a> · <a href={selected.manifest.supportUrl} target="_blank" rel="noopener noreferrer"><WorkspaceText text="Developer support" /></a></p>
      <h3>{selected.manifest.price.amountCents ? `$${(selected.manifest.price.amountCents/100).toFixed(2)} USD` : <WorkspaceText text="Free" />}</h3><p><WorkspaceText text="One-time access for this version and salon. Future paid versions require a separate purchase and approval." /></p>
      {!selected.entitled && selected.manifest.price.amountCents>0 && <AppForm onConfirmed={onConfirmed} operation="checkout" key={"checkout:" + selected.id + ":" + selected.sha256} salon={data.salonId} label="Buy this version · test payment" disabled={!data.testPaymentsEnabled}><input type="hidden" name="version" value={selected.id} /><input type="hidden" name="sha256" value={selected.sha256} /></AppForm>}
      {!selected.entitled && <p className={styles.previewNote}><WorkspaceText text={data.testPaymentsEnabled ? "Payment must be verified before activation." : "Paid activation is unavailable until marketplace payments are configured. No payment will be taken."} /></p>}
      {(!installed || installed.versionId!==selected.id || !installed.usable) && <AppForm onConfirmed={onConfirmed} operation="install" requiresConsent key={"install:" + selected.id + ":" + selected.sha256} salon={data.salonId} label={installed ? "Approve update for this salon" : "Activate for this salon"} disabled={!selected.entitled}><input type="hidden" name="version" value={selected.id} /><input type="hidden" name="sha256" value={selected.sha256} /><input type="hidden" name="scopes" value={JSON.stringify(selected.manifest.scopes)} /></AppForm>}
      {installed?.usable && installed.versionId === selected.id && <AppForm onConfirmed={onConfirmed} salon={data.salonId} operation="connect" key={"connect:" + installed.id + ":" + selected.id} label="Open and connect app" disabled={!status?.canOpen}><input type="hidden" name="installation" value={installed.id} /></AppForm>}
      {installed && !installed.connectionReady && <p><WorkspaceText text="The developer has not finished connection setup. You will not be asked to copy tokens." /></p>}{installed && revoke(installed)}
      <details><summary><WorkspaceText text="Version verification" /></summary><p>SHA-256: <code>{selected.sha256}</code></p><p><WorkspaceText text="Approval covers the connection manifest. Hosted application code remains on developer infrastructure." /></p></details>
    </>}</dialog>
  </>;
}
