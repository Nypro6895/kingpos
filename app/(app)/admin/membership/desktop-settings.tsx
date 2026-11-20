"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { defaultWebsiteCopy, parseMoney, serviceBenefits } from "@/lib/membership-model";
import { usageResourceKeys, resourceLabels, type MembershipConfig, type MembershipPlan, type MembershipWebsiteSettings, type MembershipWebsiteCopy } from "@/types/reylumi-membership";
import { MembershipWebsite } from "../../../(legal)/membership/website";
import type { Command } from "./operations";
import s from "./membership.module.css";

export function DesktopSettings({ plans, website, section, busy, editable, command, onSectionChange }: {
  plans: MembershipPlan[]; website?: MembershipWebsiteSettings; section: string;
  busy: boolean; editable: boolean; command: Command; onSectionChange:(section:string)=>void;
}) {
  const [drafts, setDrafts] = useState(() => plans.map(p => ({ ...p, config: structuredClone(p.config), selling: typeof p.config.enrollment_open === 'boolean' ? p.config.enrollment_open : p.selling })));
  const [copy, setCopy] = useState<MembershipWebsiteCopy>(() => structuredClone(website?.draft ?? defaultWebsiteCopy));
  const [selected, setSelected] = useState(0), [preview, setPreview] = useState(false), [error, setError] = useState("");
  const root = useRef<HTMLFormElement>(null);
  const draftChanged = drafts.some((p, i) => JSON.stringify(p.config) !== JSON.stringify(plans[i].config)) || JSON.stringify(copy) !== JSON.stringify(website?.draft ?? defaultWebsiteCopy);
  const publicationChanged = drafts.some(p => JSON.stringify(p.config) !== JSON.stringify(p.published_config) || p.selling !== plans.find(x => x.key === p.key)?.selling) || JSON.stringify(copy) !== JSON.stringify(website?.published);
  useEffect(() => {
    if (!draftChanged) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [draftChanged]);
  function update<K extends keyof MembershipConfig>(i: number, key: K, value: MembershipConfig[K]) { setDrafts(rows => rows.map((p, n) => n === i ? { ...p, config: { ...p.config, [key]: value } } : p)); }
  function service(i: number, key: keyof ReturnType<typeof serviceBenefits>, value: string | number | null) {
    update(i, "service", { ...serviceBenefits(drafts[i].config), [key]: value });
  }
  async function save(publish: boolean) {
    setError("");
    const invalid=root.current?.querySelector<HTMLInputElement>('[aria-invalid="true"],input:invalid,textarea:invalid,select:invalid');
    if(invalid){onSectionChange(invalid.closest<HTMLElement>('[data-settings-section]')?.dataset.settingsSection??section);setError(`Correct ${invalid.getAttribute('aria-label')??'the highlighted value'} before saving.`);requestAnimationFrame(()=>invalid.focus());return;}
    const changed = drafts.filter((p, i) => JSON.stringify(p.config) !== JSON.stringify(plans[i].config) || (publish && (JSON.stringify(p.config) !== JSON.stringify(p.published_config) || p.selling !== plans[i].selling)));
    const changedCopy = JSON.stringify(copy) !== JSON.stringify(website?.draft ?? defaultWebsiteCopy) || (publish && JSON.stringify(copy) !== JSON.stringify(website?.published));
    if (!changed.length && !changedCopy) return;
    await command({ action: "save_settings", plans: changed.map(p => ({ key: p.key, revision: p.revision, config: { ...p.config, benefits: p.config.benefits.map(x => x.trim()).filter(Boolean) }, selling: p.selling })),
      ...(changedCopy ? { website: { revision: website?.revision ?? 1, config: copy } } : {}), publish, reason: publish ? "Publish membership settings" : "Save membership settings draft" });
  }
  function row(label: string, cell: (p: MembershipPlan, i: number) => ReactNode) { return <tr key={label}><th scope="row">{label}</th>{drafts.map((p, i) => <td key={p.key}>{cell(p, i)}</td>)}</tr>; }
  function select(i: number, label: string, value: string, options: string[][], change: (v: string) => void) {
    return <select aria-label={`${drafts[i].config.name} ${label}`} value={value} onChange={e => change(e.target.value)}>{options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select>;
  }
  const plan = drafts[selected];
  return <>
    <form ref={root} className={s.panel} onSubmit={e => { e.preventDefault(); void save(true); }}>
      <div className={s.subheading}><div><h2>{section === "plans" ? "Plans & pricing" : section === "usage" ? "SMS & credit allowances" : "Membership website"}</h2><small className={s.muted}>{draftChanged ? "Unsaved changes" : "Draft saved"} · Changes to existing salon terms are never automatic.</small></div><div className={s.links}>
        {section === "website" && <button type="button" onClick={() => setPreview(true)}>Preview website ↗</button>}
        <button type="button" disabled={busy || !editable || !draftChanged} onClick={() => save(false)}>Save draft</button>
        <button className={s.primary} disabled={busy || !editable || !publicationChanged}>Save & publish</button>
      </div></div>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || !editable} className={s.fieldset}>
        <div hidden={section !== "plans"} data-settings-section="plans">
          <p className={s.muted}>All three plans include released Reylumi plugins. Third-party plugins are sold separately.</p>
          <div className={s.tableWrap}><table className={s.settingsTable}><thead><tr><th>Setting</th>{drafts.map(p => <th key={p.key}>{p.config.name}</th>)}</tr></thead><tbody>
            {row("Plan name", (p, i) => <input aria-label={`${p.key} name`} required minLength={2} maxLength={80} value={p.config.name} onChange={e => update(i, "name", e.target.value)} />)}
            {row("Monthly price · USD", (p, i) => <AmountInput label={`${p.key} monthly price`} value={p.config.monthly_cents} update={v => update(i, "monthly_cents", v)} />)}
            {row("Annual price · USD", (p, i) => <AmountInput label={`${p.key} annual price`} value={p.config.annual_cents} update={v => update(i, "annual_cents", v)} />)}
            {row("Verified payment methods", (p, i) => <div className={s.paymentMethods}>{([['bank', 'Bank'], ['cash', 'Cash'], ['other', 'Other']] as const).map(([key, text]) => <label key={key}><input type="checkbox" checked={p.config.payment_methods.includes(key)} onChange={e => update(i, 'payment_methods', e.target.checked ? [...p.config.payment_methods, key] : p.config.payment_methods.filter(x => x !== key))} />{text}</label>)}</div>)}
            {row("Initial setup / delivery", (p, i) => <div className={s.setupCell}>{select(i, 'initial setup', serviceBenefits(p.config).setup, [['included', 'Included'], ['not_included', 'Not included'], ['by_agreement', 'By agreement']], v => service(i, 'setup', v))}{select(i, 'setup delivery', serviceBenefits(p.config).method, [['remote', 'Remote'], ['onsite', 'On-site'], ['by_agreement', 'By agreement']], v => service(i, 'method', v))}</div>)}
            {row("Training sessions", (p, i) => <input aria-label={`${p.key} training sessions`} type="number" min={0} max={100} step={1} placeholder="By agreement" value={serviceBenefits(p.config).training_sessions ?? ''} onChange={e => service(i, 'training_sessions', e.target.value === '' ? null : Number(e.target.value))} />)}
            {row("Support", (p, i) => select(i, 'support level', serviceBenefits(p.config).support, [['standard', 'Standard'], ['priority', 'Priority'], ['dedicated', 'Dedicated contact']], v => service(i, 'support', v)))}
            {row("Reylumi member blue check", (p, i) => <label className={s.check}><input type="checkbox" checked={p.config.salon_member_badge === true} onChange={e => update(i, 'salon_member_badge', e.target.checked)} />Included</label>)}
            {row("Enrollment", (p, i) => <label className={s.check}><input type="checkbox" checked={p.selling} onChange={e => { const checked=e.target.checked; setDrafts(rows => rows.map((x,n)=>n===i?{...x,selling:checked,config:{...x.config,enrollment_open:checked}}:x)); }} />Open</label>)}
          </tbody></table></div>
          <p className={s.muted}>Blank prices mean “to be confirmed”. Enrollment switches apply on publication. Setup and training are managed by scope or session, not by minutes.</p>
          <p className={s.muted}>The blue check identifies an active Reylumi member salon. It is separate from identity approval and customer feedback. Published benefits apply to new salon terms.</p>
        </div>
        <div hidden={section !== "usage"} data-settings-section="usage">
          <div className={s.tableWrap}><table className={s.settingsTable}><thead><tr><th>Included service</th>{drafts.map(p => <th key={p.key}>{p.config.name}</th>)}</tr></thead><tbody>
            {usageResourceKeys.map(key => row(resourceLabels[key], (p, i) => <div className={s.allowanceCell}><input aria-label={`${p.key} ${key} allowance`} type="number" min={0} max={10000000} step={1} value={p.config.allowances[key].amount} onChange={e => update(i, 'allowances', { ...p.config.allowances, [key]: { ...p.config.allowances[key], amount: Number(e.target.value) } })} /><select aria-label={`${p.key} ${key} period`} value={p.config.allowances[key].period} onChange={e => update(i, 'allowances', { ...p.config.allowances, [key]: { ...p.config.allowances[key], period: e.target.value as 'month'|'term', rollover: e.target.value === 'term' ? 0 : p.config.allowances[key].rollover } })}><option value="month">/ month</option><option value="term">/ term</option></select></div>))}
          </tbody></table></div>
          <p className={s.muted}>SMS uses segments. Campaign credit is for campaign delivery, not advertising spend. Adjust a salon’s individual balance in Manage.</p>
          <details className={s.advanced}><summary>Carry-forward caps & additional-use reference prices</summary>
            <div className={s.tableWrap}><table className={s.settingsTable}><thead><tr><th>Service</th>{drafts.map(p => <th key={p.key}>{p.config.name}</th>)}</tr></thead><tbody>{usageResourceKeys.map(key => row(resourceLabels[key], (p, i) => <div className={s.extraFields}><label>Carry-forward cap<input aria-label={`${p.key} ${key} carry-forward cap`} type="number" min={0} max={10000000} disabled={p.config.allowances[key].period === 'term'} value={p.config.allowances[key].rollover} onChange={e => update(i, 'allowances', { ...p.config.allowances, [key]: { ...p.config.allowances[key], rollover: Number(e.target.value) } })} /></label><label>Extra unit · USD<AmountInput label={`${p.key} ${key} extra unit`} value={p.config.allowances[key].overage_cents} update={v => update(i, 'allowances', { ...p.config.allowances, [key]: { ...p.config.allowances[key], overage_cents: v } })} /></label></div>))}</tbody></table></div>
            <p className={s.muted}>Carry-forward is limited to the same membership term. Extra use needs approval; these reference prices do not trigger automatic charges.</p>
          </details>
        </div>
        <div hidden={section !== "website"} data-settings-section="website" className={s.websiteSettings}>
          <div className={s.formGrid}>{([['title','Main headline'],['cta','Contact button label']] as const).map(([key,label]) => <label className={s.field} key={key}><span>{label}</span><input value={copy[key]} maxLength={key==='title'?160:60} required onChange={e => setCopy(c=>({...c,[key]:e.target.value}))}/></label>)}<label className={`${s.field} ${s.fullWidth}`}><span>Introduction</span><textarea rows={2} maxLength={4000} value={copy.intro} onChange={e=>setCopy(c=>({...c,intro:e.target.value}))}/></label></div>
          <div className={s.toolbar}><strong>Plan card content</strong>{drafts.map((p,i)=><button type="button" key={p.key} aria-pressed={selected===i} onClick={()=>setSelected(i)}>{p.config.name}</button>)}</div>
          <div className={s.formGrid}><label className={s.field}><span>Short benefit statement</span><input aria-label="Card benefit statement" maxLength={200} value={plan.config.tagline} onChange={e=>update(selected,'tagline',e.target.value)}/></label><label className={s.field}><span>Badge</span><input maxLength={60} value={plan.config.badge} onChange={e=>update(selected,'badge',e.target.value)}/></label><label className={s.field}><span>Plan description</span><textarea rows={2} maxLength={4000} value={plan.config.description} onChange={e=>update(selected,'description',e.target.value)}/></label><label className={s.field}><span>Additional benefits · one per line</span><textarea rows={2} value={plan.config.benefits.join('\n')} onChange={e=>update(selected,'benefits',e.target.value.split('\n'))}/></label></div>
          <details className={s.advanced}><summary>Support scope, future features & explanations</summary><div className={s.formGrid}><label className={s.field}><span>Support scope for {plan.config.name}</span><textarea rows={2} maxLength={4000} value={plan.config.support_description} onChange={e=>update(selected,'support_description',e.target.value)}/></label><label className={s.field}><span>Response target / service hours</span><input maxLength={200} value={plan.config.response_target} onChange={e=>update(selected,'response_target',e.target.value)}/></label><label className={s.field}><span>Future features · website</span><textarea rows={2} maxLength={4000} value={copy.future} onChange={e=>setCopy(c=>({...c,future:e.target.value}))}/></label><label className={s.field}><span>Additional explanation / FAQ</span><textarea rows={2} maxLength={4000} value={copy.faq} onChange={e=>setCopy(c=>({...c,faq:e.target.value}))}/></label><label className={s.field}><span>Future features · this plan</span><textarea rows={2} maxLength={4000} value={plan.config.future_features} onChange={e=>update(selected,'future_features',e.target.value)}/></label><label className={s.check}><input type="checkbox" checked={plan.config.early_access} onChange={e=>update(selected,'early_access',e.target.checked)}/>Optional early-access invitations</label></div></details>
          <p className={s.muted}>Names, prices, allowances and service benefits are generated from plan settings. They are not entered again here.</p>
        </div>
      </fieldset>
    </form>
    {preview && <WebsitePreview close={()=>setPreview(false)} plans={drafts} copy={copy}/>}
  </>;
}
function AmountInput({label,value,update}:{label:string;value:number|null;update:(v:number|null)=>void}) {
  const [text,setText]=useState(value===null?'':(value/100).toFixed(2)),[invalid,setInvalid]=useState(false);
  return <input aria-label={label} inputMode="decimal" aria-invalid={invalid} value={text} placeholder="To be confirmed" onChange={e=>{setText(e.target.value);try{update(parseMoney(e.target.value));setInvalid(false);}catch{setInvalid(true);}}}/>;
}
function WebsitePreview({plans,copy,close}:{plans:MembershipPlan[];copy:MembershipWebsiteCopy;close:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
  return <dialog className={s.websitePreview} ref={ref} onCancel={close} aria-label="Draft membership website preview"><header><strong>Website preview · unsaved draft</strong><button onClick={close}>Close preview</button></header><MembershipWebsite plans={plans.map(p=>({key:p.key,config:{...p.config,benefits:p.config.benefits.filter(x=>x.trim())},selling:p.selling}))} copy={copy} preview/></dialog>;
}
