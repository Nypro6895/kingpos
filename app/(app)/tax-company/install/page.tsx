import { withExperiencePage } from "@/components/experience-page";
import Link from "next/link";
import { TaxAppInstallControl } from "@/app/tax-company/install-control";
function InstallTaxApp() { return <main className="grid w-full min-w-0 gap-5 px-4 py-8"><h1 className="text-2xl font-semibold">Install Reylumi Tax Company</h1><p className="max-w-prose">Manage multiple salons, review payroll tax reports and upload staff paystubs from one app.</p><section className="min-w-0 border-y border-zinc-200 py-5"><TaxAppInstallControl /></section><Link href="/tax-company" className="justify-self-start rounded-lg bg-zinc-950 p-3 text-center text-white">Open Tax Company</Link><p className="max-w-prose">Sign in or create your personal account, then add each salon using the ID and password its owner provides.</p></main>; }

export default withExperiencePage(InstallTaxApp);
