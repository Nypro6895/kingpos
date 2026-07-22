import { getCurrentKingUser } from "@/lib/users/current-user";
import Link from "next/link";
import { redirect } from "next/navigation";

function initialsFor(label: string | null | undefined) {
  const parts = (label ?? "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "K";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function displayName(input: {
  displayName: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}) {
  const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();

  return (
    input.displayName ??
    (fullName || null) ??
    input.email ??
    "Reylumi customer"
  );
}

function safeImageUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.startsWith("http://") || value.startsWith("https://")
    ? value
    : null;
}

export default async function BeautyPage() {
  const user = await getCurrentKingUser();

  if (!user) {
    redirect("/login?next=/beauty");
  }

  const name = displayName({
    displayName: user.display_name,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
  });
  const avatarUrl = safeImageUrl(user.avatar_url);

  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-[0_16px_45px_rgba(23,19,22,0.06)]">
          <div className="h-28 bg-[linear-gradient(135deg,var(--brand-orange-soft),#f4f1ed)]" />
          <div className="grid gap-4 px-4 pb-5 sm:px-5">
            <div className="-mt-9 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 items-end gap-3">
                <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-white bg-brand-black text-lg font-extrabold text-brand-orange shadow-sm">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={`${name} profile`}
                      className="h-full w-full object-cover"
                      src={avatarUrl}
                    />
                  ) : (
                    initialsFor(name)
                  )}
                </span>
                <div className="min-w-0 pb-1">
                  <p className="text-xs font-bold uppercase text-brand-orange">
                    Beauty
                  </p>
                  <h1 className="truncate text-2xl font-extrabold text-text-primary">
                    {name}
                  </h1>
                  <p className="mt-1 truncate text-sm font-semibold text-text-secondary">
                    Personal account
                  </p>
                </div>
              </div>
              <Link
                className="inline-flex min-h-11 w-fit items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#ef5d28] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href="/account"
              >
                Edit profile
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-3 rounded-2xl border border-dashed border-border-subtle bg-surface px-4 py-6 text-center shadow-sm">
          <h2 className="text-lg font-extrabold text-text-primary">
            Beauty Timeline
          </h2>
          <p className="mx-auto max-w-md text-sm leading-6 text-text-secondary">
            Your saved looks, reviews, and before-and-after moments will appear
            here when they are available for your account.
          </p>
          <Link
            className="mx-auto inline-flex min-h-11 items-center justify-center rounded-full border border-border-subtle bg-white px-4 text-sm font-bold text-text-primary transition hover:border-brand-orange/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href="/explore"
          >
            Explore salons
          </Link>
        </section>
      </div>
    </main>
  );
}
