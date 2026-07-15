import { getCurrentBusinessContext } from "@/lib/current-context";
import Link from "next/link";
import { redirect } from "next/navigation";

type SettingsLink = {
  description: string;
  href: string;
  id: string;
  label: string;
};

function SettingsCard({ link }: { link: SettingsLink }) {
  return (
    <Link
      className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 transition hover:border-zinc-300 hover:shadow-sm"
      href={link.href}
    >
      <span className="text-lg font-semibold text-zinc-950">{link.label}</span>
      <span className="text-sm text-zinc-600">{link.description}</span>
    </Link>
  );
}

export default async function SettingsPage() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    redirect("/login?next=/settings");
  }

  const accountLinks: SettingsLink[] = [
    {
      description: "Profile, phone, locale, timezone, and sign-out access.",
      href: "/account",
      id: "account",
      label: "Account profile",
    },
    {
      description: "Invites, applications, and salon connection lifecycle.",
      href: "/staff/connections",
      id: "connections",
      label: "Connections",
    },
    {
      description: "Switch between personal, organization, staff, and manage contexts.",
      href: "/my-place",
      id: "my-place",
      label: "My Place",
    },
    {
      description: "Account notifications and pending connection activity.",
      href: "/notifications",
      id: "notifications",
      label: "Notifications",
    },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="border-b border-zinc-200 pb-6">
        <p className="text-sm font-semibold text-zinc-500">Settings</p>
        <h1 className="mt-1 text-3xl font-semibold text-zinc-950">
          Account Settings
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600">
          Personal account controls stay separate from salon and organization
          administration.
        </p>
      </div>

      <section className="mt-6 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-zinc-500">Account</p>
          <p className="mt-2 truncate text-lg font-semibold text-zinc-950">
            {context.user.display_name ?? context.user.email ?? "KingPOS account"}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-zinc-500">
            Selected workspace
          </p>
          <p className="mt-2 truncate text-lg font-semibold text-zinc-950">
            {context.currentWorkspace?.label ?? "Personal"}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-zinc-500">Role</p>
          <p className="mt-2 truncate text-lg font-semibold text-zinc-950">
            {context.activeRole?.label ?? "Account"}
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Account</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {accountLinks.map((link) => (
            <SettingsCard key={link.id} link={link} />
          ))}
        </div>
      </section>
    </main>
  );
}
