import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { hasPermission } from "@/lib/permissions";
import Link from "next/link";

export default async function PortablePosPage() {
  const context = await requireSalonManagePageContext("/pos/portable");
  const canUsePos = await hasPermission("tickets.manage", context);

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-5 text-text-primary sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-4xl gap-5">
        <header>
          <p className="text-xs font-bold uppercase text-brand-orange">POS</p>
          <h1 className="mt-1 text-3xl font-extrabold">Portable POS</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold text-text-secondary">
            {context.currentSalon.name}
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-2">
          <article className="grid gap-4 rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm">
            <div>
              <p className="text-xs font-bold uppercase text-brand-orange">
                Register
              </p>
              <h2 className="mt-1 text-xl font-extrabold">POS Desk</h2>
              <p className="mt-2 text-sm font-semibold text-text-secondary">
                Open the active POS workspace for tickets, services, checkout,
                and customer display.
              </p>
            </div>
            {canUsePos ? (
              <div className="flex flex-wrap gap-2">
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-bold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                  href="/pos"
                >
                  Open POS
                </Link>
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-subtle px-4 text-sm font-bold text-text-primary transition hover:border-brand-orange/40 hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                  href="/pos/customer-display"
                >
                  Customer Display
                </Link>
              </div>
            ) : (
              <p className="rounded-xl border border-border-subtle bg-surface-muted px-4 py-3 text-sm font-semibold text-text-secondary">
                POS access is not enabled for this account.
              </p>
            )}
          </article>

          <article className="grid gap-4 rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm">
            <div>
              <p className="text-xs font-bold uppercase text-brand-orange">
                Access
              </p>
              <h2 className="mt-1 text-xl font-extrabold">Staff POS Access</h2>
              <p className="mt-2 text-sm font-semibold text-text-secondary">
                Staff and manager password management is visible in Setting.
                Full create, rotate, use, and revoke flows are not enabled yet.
              </p>
            </div>
            <Link
              className="inline-flex min-h-11 w-fit items-center justify-center rounded-full border border-border-subtle px-4 text-sm font-bold text-text-primary transition hover:border-brand-orange/40 hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href="/salon-settings#pos-access"
            >
              Open Setting
            </Link>
          </article>
        </section>
      </div>
    </main>
  );
}
