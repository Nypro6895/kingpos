import { LoginSecurityPanel } from "@/app/settings/login-security/login-security-panel";
import { loadLoginSecurityOverview } from "@/lib/account-security";
import Link from "next/link";
import { redirect } from "next/navigation";

const LOGIN_SECURITY_SECTIONS = [
  { href: "#quick-actions", label: "Quick actions" },
  { href: "#sessions", label: "Sessions" },
  { href: "#trusted-devices", label: "Trusted devices" },
  { href: "#two-factor", label: "2FA setup" },
  { href: "#recovery-contact", label: "Recovery contacts" },
  { href: "#recovery-codes", label: "Recovery codes" },
  { href: "#account-recovery", label: "Account recovery" },
  { href: "#secure-account", label: "Secure account" },
  { href: "#activity", label: "Activity" },
];

function accountStatusLabel(status: string) {
  return status === "pending_deletion"
    ? "Pending deletion"
    : status === "active"
      ? "Active"
      : status;
}

function accountStatusClass(status: string) {
  return status === "active"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : "bg-amber-50 text-amber-700 ring-amber-200";
}

export default async function LoginSecurityPage() {
  const overview = await loadLoginSecurityOverview();

  if (!overview) {
    redirect("/login?next=/settings/login-security");
  }

  const accountLabel = overview.account.email ?? "Reylumi account";
  const statusLabel = accountStatusLabel(overview.account.status);

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-5">
        <header className="rounded-lg border border-border-subtle bg-white px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-zinc-500">
                  Account security
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-normal text-zinc-950">
                  Login Security
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                  Quick edits first, detailed setup below.
                </p>
              </div>
              <div className="grid gap-2 sm:justify-items-end">
                <span
                  className={[
                    "inline-flex min-h-8 w-fit items-center rounded-full px-3 text-xs font-semibold ring-1 ring-inset",
                    accountStatusClass(overview.account.status),
                  ].join(" ")}
                >
                  {statusLabel}
                </span>
                <p className="max-w-64 truncate text-sm font-semibold text-zinc-500">
                  {accountLabel}
                </p>
              </div>
            </div>
            <nav
              aria-label="Login security sections"
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
            >
              {LOGIN_SECURITY_SECTIONS.map((section) => (
                <a
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-zinc-700 ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                  href={section.href}
                  key={section.href}
                >
                  {section.label}
                </a>
              ))}
              <Link
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                href="/settings"
              >
                All settings
              </Link>
            </nav>
          </div>
        </header>

        <LoginSecurityPanel overview={overview} />
      </div>
    </main>
  );
}
