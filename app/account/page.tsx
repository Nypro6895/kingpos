import { AccountProfileEditor } from "@/app/account/account-profile-editor";
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
        <h1 className="text-2xl font-semibold text-zinc-950">Account</h1>
        <p className="mt-4 text-zinc-700">You need to log in to view your account.</p>
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

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <AccountProfileEditor
          createdAtLabel={formatDateTime(user.created_at, user.timezone)}
          key={user.updated_at}
          user={user}
        />
      </div>
    </main>
  );
}
