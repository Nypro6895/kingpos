import { withExperiencePage } from "@/components/experience-page";
import Link from "next/link";
import { taxCompanyReport } from "@/lib/tax-company";
import { taxPayrollScheduleLabel, taxSalonAddress } from "@/lib/tax-company-periods";
import { TaxCompanyCalculationGuide, TaxCompanyLinesTable } from "@/app/payroll/tax-company-table";
import { disconnectTaxSalon } from "@/app/tax-company/actions";
import { TaxCompanyNoteEditor } from "@/app/tax-company/note-editor";
import { TaxPeriodPicker } from "@/app/tax-company/period-picker";
import styles from "@/app/tax-company/tax-company.module.css";
import { SubmitButton } from "@/components/submit-button";

async function TaxSalonPage({ params, searchParams }: { params: Promise<{ salonId: string }>; searchParams: Promise<{ run?: string; period?: string; message?: string }> }) {
  const { salonId } = await params, query = await searchParams;
  let data: Awaited<ReturnType<typeof taxCompanyReport>>;
  try { data = await taxCompanyReport(salonId, query.run, query.period); }
  catch (error) { return <main className={styles.page}><p role="alert" className={styles.notice}>{error instanceof Error ? error.message : "Report unavailable."}</p><Link href="/tax-company" className={styles.back}>← My salons</Link></main>; }
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

export default withExperiencePage(TaxSalonPage);
