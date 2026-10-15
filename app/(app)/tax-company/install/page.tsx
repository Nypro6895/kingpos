import { withExperiencePage } from "@/components/experience-page";
import Link from "next/link";
import { TaxAppInstallControl } from "@/app/tax-company/install-control";
function InstallTaxApp() { return <main className="mx-auto grid max-w-2xl gap-5 p-8"><h1 className="text-2xl font-semibold">Install Reylumi Tax Company</h1><p>Manage multiple salons, review payroll tax reports and upload staff paystubs from one app.</p><section className="rounded-xl border p-5"><TaxAppInstallControl /></section><Link href="/tax-company" className="rounded-lg bg-zinc-950 p-3 text-center text-white">Open Tax Company</Link><p>Sign in or create your personal account, then add each salon using the ID and password its owner provides.</p></main>; }

export default withExperiencePage(InstallTaxApp);
