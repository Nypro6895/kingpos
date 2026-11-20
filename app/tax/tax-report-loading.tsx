import { WorkspaceText } from "@/components/workspace-language";
import styles from "./tax-report-loading.module.css";

/** Public chrome only: no previous salon, employee or cached figure is shown. */
export function TaxReportLoading() {
  return <main className={styles.page} aria-busy="true" data-tax-report-loading>
    <h1>Tax</h1>
    <p role="status"><WorkspaceText text="Loading published tax figures…" /></p>
    <div className={styles.filters} aria-hidden="true"><span /><span /><span /></div>
    <div className={styles.grid} aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => <div key={index}><span /><span /><span /><span /></div>)}
    </div>
  </main>;
}
