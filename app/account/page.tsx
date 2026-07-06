import { LogoutButton } from "@/app/account/logout-button";
import { createSupabaseServerClient, getSupabaseAuthUser } from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";

function readOptionalString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue || null;
}

async function updateProfile(formData: FormData) {
  "use server";

  const supabase = createSupabaseServerClient();
  const authUser = await getSupabaseAuthUser();

  if (!supabase || !authUser) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("users")
    .update({
      display_name: readOptionalString(formData, "display_name"),
      first_name: readOptionalString(formData, "first_name"),
      last_name: readOptionalString(formData, "last_name"),
      phone: readOptionalString(formData, "phone"),
      language: readOptionalString(formData, "language") ?? "en",
      timezone: readOptionalString(formData, "timezone") ?? "America/Chicago",
    })
    .eq("auth_user_id", authUser.id);

  if (error) {
    throw new Error("Unable to update profile.");
  }

  revalidatePath("/account");
  redirect("/account");
}

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

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border-b border-zinc-200 py-4 last:border-b-0 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-zinc-950 sm:col-span-2 sm:mt-0">
        {value || "-"}
      </dd>
    </div>
  );
}

function InputField({
  label,
  name,
  value,
  autoComplete,
}: {
  label: string;
  name: string;
  value: string | null;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
        defaultValue={value ?? ""}
        name={name}
        type="text"
      />
    </label>
  );
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
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-500">KingPOS Account</p>
          <h1 className="mt-1 text-3xl font-semibold text-zinc-950">User Profile</h1>
          <p className="mt-2 text-sm text-zinc-600">
            View your account details and update your personal information.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/organizations"
          >
            Organizations
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/salons"
          >
            Salons
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/permissions"
          >
            Permissions
          </Link>
          <LogoutButton />
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Profile details</h2>
        <dl className="mt-4 rounded-lg border border-zinc-200 bg-white px-5">
          <Field label="Display name" value={user.display_name} />
          <Field label="First name" value={user.first_name} />
          <Field label="Last name" value={user.last_name} />
          <Field label="Email" value={user.email} />
          <Field label="Phone" value={user.phone} />
          <Field label="Status" value={user.status} />
          <Field label="Language" value={user.language} />
          <Field label="Timezone" value={user.timezone} />
          <Field label="Created at" value={formatDateTime(user.created_at, user.timezone)} />
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-950">Edit profile</h2>
        <form
          action={updateProfile}
          className="mt-4 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
        >
          <InputField
            autoComplete="name"
            label="Display name"
            name="display_name"
            value={user.display_name}
          />
          <InputField
            autoComplete="given-name"
            label="First name"
            name="first_name"
            value={user.first_name}
          />
          <InputField
            autoComplete="family-name"
            label="Last name"
            name="last_name"
            value={user.last_name}
          />
          <InputField autoComplete="tel" label="Phone" name="phone" value={user.phone} />
          <InputField label="Language" name="language" value={user.language} />
          <InputField label="Timezone" name="timezone" value={user.timezone} />

          <div className="rounded-md bg-zinc-50 p-4 text-sm text-zinc-600 sm:col-span-2">
            Email, status, auth user ID, and created date are read-only account fields.
          </div>

          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <button
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
              type="submit"
            >
              Save profile
            </button>
            <Link
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
              href="/account"
            >
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
