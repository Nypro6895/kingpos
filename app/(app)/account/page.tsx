import { AccountDeletionPanel } from "@/app/account/account-deletion-panel";
import { AccountProfileEditor } from "@/app/account/account-profile-editor";
import { analyzeAccountDeletionImpact } from "@/lib/account-deletion";
import type { AccountDeletionImpact } from "@/lib/account-deletion";
import { getCurrentKingUser } from "@/lib/users/current-user";
import Link from "next/link";

function formatDateTime(value: string | null, timezone: string | null) {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone || "America/Chicago",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default async function AccountPage() {
  const user = await getCurrentKingUser();

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-12">
        <p className="text-zinc-700">You need to log in to view your account.</p>
        <div className="mt-6 flex gap-3">
          <Link
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
            href="/login"
          >
            Login
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/signup"
          >
            Sign up
          </Link>
        </div>
      </main>
    );
  }

  let deletionImpact: AccountDeletionImpact | null = null;
  let deletionImpactError: string | undefined;

  try {
    deletionImpact = await analyzeAccountDeletionImpact();
  } catch (error) {
    deletionImpactError =
      error instanceof Error
        ? error.message
        : "Account deletion status could not be loaded.";
  }

  const accountStatusLabel =
    user.status === "pending_deletion" ? "Pending deletion" : "Active";
  const accountStatusClass =
    user.status === "pending_deletion"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-emerald-50 text-emerald-700 ring-emerald-200";

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="h-fit rounded-lg border border-border-subtle bg-white p-3 lg:sticky lg:top-5">
          <div className="border-b border-zinc-100 px-2 pb-3">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Personal
            </p>
            <h1 className="mt-1 truncate text-lg font-semibold text-zinc-950">
              {user.display_name ?? user.email ?? "Reylumi account"}
            </h1>
            <p className="mt-1 truncate text-sm text-zinc-500">
              {accountStatusLabel}
            </p>
          </div>
          <nav aria-label="Account settings sections" className="mt-3 grid gap-1">
            <a
              className="flex min-h-10 items-center rounded-md px-2.5 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100"
              href="#profile-contact"
            >
              Profile & contact
            </a>
            <a
              className="flex min-h-10 items-center rounded-md px-2.5 py-2 text-sm font-semibold text-red-700 transition hover:bg-zinc-100"
              href="#delete-account"
            >
              Danger Zone
            </a>
          </nav>
          <Link
            className="mt-3 flex min-h-10 items-center rounded-md border border-zinc-200 px-2.5 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
            href="/settings"
          >
            All settings
          </Link>
        </aside>

        <div className="grid gap-5">
          <header className="rounded-lg border border-border-subtle bg-white px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase text-zinc-500">
                  Account controls
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-normal text-zinc-950">
                  Personal settings
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                  Profile, contact, phone verification, account backup, and
                  deletion controls in a compact workflow.
                </p>
              </div>
              <span
                className={[
                  "inline-flex min-h-8 w-fit items-center rounded-full px-3 text-xs font-semibold ring-1 ring-inset",
                  accountStatusClass,
                ].join(" ")}
              >
                {accountStatusLabel}
              </span>
            </div>
          </header>

          <AccountProfileEditor
            createdAtLabel={formatDateTime(user.created_at, user.timezone)}
            key={user.updated_at}
            user={user}
          />
          <AccountDeletionPanel
            impact={deletionImpact}
            loadError={deletionImpactError}
          />
        </div>
      </div>
    </main>
  );
}
