import { withExperiencePage } from "@/components/experience-page";
import Link from "next/link";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { taxCompanySalons } from "@/lib/tax-company";
import { taxSalonAddress, taxPayrollScheduleLabel } from "@/lib/tax-company-periods";
import { connectTaxSalon, disconnectTaxSalon } from "@/app/tax-company/actions";
import styles from "@/app/tax-company/tax-company.module.css";

async function TaxCompanyPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const context = await getCurrentBusinessContext(), query = await searchParams;
  if (!context.user) return <main className={styles.page}><h1 className={styles.title}>Reylumi Tax Company</h1><p>Use your personal Reylumi account to manage tax payroll for multiple salons.</p><div className={styles.actions}><Link className={styles.primary} href="/login?next=%2Ftax-company">Sign in</Link><Link className={styles.button} href="/signup">Create personal account</Link></div></main>;
  let salons: Awaited<ReturnType<typeof taxCompanySalons>> = [], error = "";
  try { salons = await taxCompanySalons(); } catch (cause) { error = cause instanceof Error ? cause.message : "Salons could not load."; }
  return <main className={styles.page}>
    <header className={styles.header}><div><span className={styles.eyebrow}>Your workspace</span><h1>Tax Company</h1><p className={styles.muted}>Payroll, paystubs and notes for your connected salons.</p></div><div className={styles.actions}><Link className={styles.button} href="/tax-company/install">Install app</Link><Link className={styles.button} href="/account">My account</Link></div></header>
    {(query.message || error) && <p role="alert" className={styles.notice}>{query.message || error}</p>}
    <section className={styles.panel}><div className={styles.panelHead}><h2>My salons · {salons.length}</h2><span className={styles.muted}>Saved to your personal account</span></div>
      {salons.length ? <><div className={styles.listHead} aria-hidden="true"><span>Salon & contact</span><span>Payroll schedule</span><span>Access</span><span /></div><ul aria-label="Connected salons">{salons.map(salon => <li key={salon.id} className={styles.salonRow}><div className={styles.salonInfo}><h3>{salon.name}</h3><p className={styles.muted}>{taxSalonAddress(salon) || "Address not added"}</p>{salon.phone && <p className={styles.muted}>{salon.phone}</p>}</div><p className={styles.schedule}>{taxPayrollScheduleLabel(salon.cycle_type)}</p><span className={salon.active ? styles.badge : styles.inactive}>{salon.active ? "Connected" : "Inactive"}</span><div className={styles.actions}>{salon.active && <Link href={`/tax-company/${salon.id}`} className={styles.button}>Open salon</Link>}<form action={disconnectTaxSalon}><input name="salon_id" value={salon.id} type="hidden" /><button className={styles.button} aria-label={`Sign out ${salon.name}`}>Sign out</button></form></div></li>)}</ul></> : <p className={styles.empty}>Add your first salon using the ID and password provided by its owner.</p>}
    </section>
    <details className={styles.addSalon} open={salons.length === 0 || Boolean(query.message)}><summary>+ Connect another salon</summary><form action={connectTaxSalon} className={styles.formGrid}><label className={styles.label}>Salon ID<input required name="login_id" autoComplete="off" maxLength={80} className={styles.input} placeholder="TAX-…" /></label><label className={styles.label}>Salon password<input required name="password" type="password" autoComplete="off" maxLength={72} className={styles.input} /></label><button className={styles.primary}>Add salon</button></form></details>
  </main>;
}

export default withExperiencePage(TaxCompanyPage);
