"use client";
// Complete original Tax Company presentation; all confirmations use the original guarded actions.
import Link from "next/link";
import {taxSalonAddress,taxPayrollScheduleLabel} from "@/lib/tax-company-periods";
import {connectTaxSalon,disconnectTaxSalon} from "@/app/tax-company/actions";
import {TaxCompanyCalculationGuide,TaxCompanyLinesTable} from "@/app/payroll/tax-company-table";
import {TaxCompanyNoteEditor} from "@/app/tax-company/note-editor";
import {TaxPeriodPicker} from "@/app/tax-company/period-picker";
import {TaxAppInstallControl} from "@/app/tax-company/install-control";
import {SubmitButton} from "@/components/submit-button";
import styles from "@/app/tax-company/tax-company.module.css";
import type {AppLocalTaxSalonsData,AppLocalTaxReportData} from "@/lib/app-local-daily-metadata";
export function AppLocalTaxSalons({salons,query}:{salons:AppLocalTaxSalonsData;query:{message?:string}}){const error="";
  return <main className={styles.page}>
    <header className={styles.header}><div><span className={styles.eyebrow}>Your workspace</span><h1>Tax Company</h1><p className={styles.muted}>Payroll, paystubs and notes for your connected salons.</p></div><div className={styles.actions}><Link className={styles.button} href="/tax-company/install">Install app</Link><Link className={styles.button} href="/account">My account</Link></div></header>
    {(query.message || error) && <p role="alert" className={styles.notice}>{query.message || error}</p>}
    <section className={styles.panel}><div className={styles.panelHead}><h2>My salons · {salons.length}</h2><span className={styles.muted}>Saved to your personal account</span></div>
      {salons.length ? <><div className={styles.listHead} aria-hidden="true"><span>Salon & contact</span><span>Payroll schedule</span><span>Access</span><span /></div><ul aria-label="Connected salons">{salons.map(salon => <li key={salon.id} className={styles.salonRow}><div className={styles.salonInfo}><h3>{salon.name}</h3><p className={styles.muted}>{taxSalonAddress(salon) || "Address not added"}</p>{salon.phone && <p className={styles.muted}>{salon.phone}</p>}</div><p className={styles.schedule}>{taxPayrollScheduleLabel(salon.cycle_type)}</p><span className={salon.active ? styles.badge : styles.inactive}>{salon.active ? "Connected" : "Inactive"}</span><div className={styles.actions}>{salon.active && <Link href={`/tax-company/${salon.id}`} className={styles.button}>Open salon</Link>}<form action={disconnectTaxSalon}><input name="salon_id" value={salon.id} type="hidden" /><SubmitButton className={styles.button} pendingLabel="Signing out…" aria-label={`Sign out ${salon.name}`}>Sign out</SubmitButton></form></div></li>)}</ul></> : <p className={styles.empty}>Add your first salon using the ID and password provided by its owner.</p>}
    </section>
    <details className={styles.addSalon} open={salons.length === 0 || Boolean(query.message)}><summary>+ Connect another salon</summary><form action={connectTaxSalon} className={styles.formGrid}><label className={styles.label}>Salon ID<input required name="login_id" autoComplete="off" maxLength={80} className={styles.input} placeholder="TAX-…" /></label><label className={styles.label}>Salon password<input required name="password" type="password" autoComplete="off" maxLength={72} className={styles.input} /></label><SubmitButton className={styles.primary} pendingLabel="Connecting…">Add salon</SubmitButton></form></details>
  </main>;
}

export function AppLocalTaxReport({data,salonId,query}:{data:AppLocalTaxReportData;salonId:string;query:{message?:string}}){
  const returnPath = `/tax-company/${salonId}?period=${encodeURIComponent(data.period.value)}`;
  const address = taxSalonAddress(data.salon);
  return <main className={styles.page}>
    <div className={styles.reportTop}>
      <section className={styles.reportIntro}>
        <div><Link href="/tax-company" className={styles.back}>← My salons</Link><h1>{data.salon.name}</h1><p className={styles.muted}>{address || "Address not added"}{data.salon.phone ? ` · ${data.salon.phone}` : ""}</p></div>
        <div><p className={styles.eyebrow}>Tax payroll</p><p className={styles.schedule}>{taxPayrollScheduleLabel(data.payrollSetting?.cycle_type)}</p><p className={styles.muted}>Follows the salon’s payroll schedule.</p></div>
        <TaxPeriodPicker salonId={salonId} options={data.periodOptions} selected={data.period.value} />
        <div className={styles.actions}><span className={data.run ? styles.badge : styles.inactive}>{data.run ? `${data.run.status === "paid" ? "Paid" : "Printed"} · Version ${data.run.version}` : "Awaiting statement"}</span><span className={styles.muted}>{data.lines.length} staff</span></div>
      </section>
      <TaxCompanyNoteEditor key={salonId} salonId={salonId} initial={data.note} />
    </div>
    {query.message && <p role="alert" className={styles.notice}>{query.message}</p>}
    {!data.run ? <div className={styles.panel}><p className={styles.empty}>The salon has not printed a payroll statement for this period yet. Paystubs can be uploaded when the statement is ready.</p></div> : <TaxCompanyLinesTable lines={data.lines} payrollRunId={data.run.id} returnPath={returnPath} taxSalonId={salonId} />}
    <TaxCompanyCalculationGuide />
    <footer className={styles.header}><p className={styles.muted}>Paystubs are shared with the salon owner and the relevant staff member.</p><form action={disconnectTaxSalon}><input name="salon_id" value={salonId} type="hidden" /><SubmitButton className={styles.button} pendingLabel="Signing out…">Sign out this salon</SubmitButton></form></footer>
  </main>;
}

export function AppLocalTaxInstall(){return <main className="mx-auto grid max-w-2xl gap-5 p-8"><h1 className="text-2xl font-semibold">Install Reylumi Tax Company</h1><p>Manage multiple salons, review payroll tax reports and upload staff paystubs from one app.</p><section className="rounded-xl border p-5"><TaxAppInstallControl/></section><Link href="/tax-company" className="rounded-lg bg-zinc-950 p-3 text-center text-white">Open Tax Company</Link><p>Sign in or create your personal account, then add each salon using the ID and password its owner provides.</p></main>}
