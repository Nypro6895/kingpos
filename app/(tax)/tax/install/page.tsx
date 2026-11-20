import Link from "next/link";
import { TaxAppInstallControl } from "@/app/tax-company/install-control";
export default function InstallTax() {
  return (
    <main className="tax-auth">
      <Link href="/tax" className="tax-brand">
        ReyLUMI <span>Tax</span>
      </Link>
      <h1>Use Tax on your computer</h1>
      <p>
        Open reylumi.com/tax in your browser or install the same workspace as
        its own Windows app window.
      </p>
      <section className="tax-panel">
        <TaxAppInstallControl />
      </section>
      <Link className="tax-primary" href="/tax">
        Open Tax workspace
      </Link>
      <p>No offline copy of business records is stored by the Tax app.</p>
    </main>
  );
}
