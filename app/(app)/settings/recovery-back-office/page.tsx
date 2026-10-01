import { RecoveryBackOfficePanel } from "@/app/settings/recovery-back-office/recovery-back-office-panel";
import { loadRecoveryBackOfficeOverview } from "@/lib/account-security-backoffice";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function RecoveryBackOfficePage() {
  const overview = await loadRecoveryBackOfficeOverview();

  if (!overview) {
    redirect("/login?next=/settings/recovery-back-office");
  }

  if (!overview.authorized) {
    return (
      <main className="min-h-screen bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-3xl gap-4 rounded-lg border border-border-subtle bg-white p-5">
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Recovery back office
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-zinc-950">
              Access restricted
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              {overview.reason}
            </p>
          </div>
          <div>
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50"
              href="/settings"
            >
              Back to Settings
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-5">
        <header className="rounded-lg border border-border-subtle bg-white px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-zinc-500">
                Support admin
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal text-zinc-950">
                Recovery Back Office
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                Review account recovery cases, inspect login security context,
                secure sessions, and record support decisions.
              </p>
            </div>
            <Link
              className="inline-flex min-h-10 w-fit items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50"
              href="/settings"
            >
              All settings
            </Link>
          </div>
        </header>

        <RecoveryBackOfficePanel overview={overview} />
      </div>
    </main>
  );
}
