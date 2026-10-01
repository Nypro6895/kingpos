import {
  acceptStaffInviteTokenFormAction,
  declineStaffInviteTokenFormAction,
} from "@/app/staff/actions";
import { StaffInviteSignupForm } from "@/app/staff/invite/[token]/staff-invite-signup-form";
import { getStaffInviteByToken } from "@/lib/staff-salon-connections";
import { getCurrentKingUser } from "@/lib/users/current-user";
import Link from "next/link";

type StaffInvitePageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<{
    connection_error?: string;
  }>;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatAddress(input: {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}) {
  return [
    input.address_line1,
    input.address_line2,
    [input.city, input.state, input.postal_code].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" - ");
}

export default async function StaffInvitePage({
  params,
  searchParams,
}: StaffInvitePageProps) {
  const [{ token }, { connection_error: connectionError }] = await Promise.all([
    params,
    searchParams,
  ]);
  const [invite, currentUser] = await Promise.all([
    getStaffInviteByToken(token),
    getCurrentKingUser(),
  ]);
  const nextPath = `/staff/invite/${encodeURIComponent(token)}`;

  if (invite.status === "invalid") {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">
          Invitation not found
        </h1>
        <p className="mt-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
          This invite link is invalid, expired, or has already been used.
        </p>
      </main>
    );
  }

  const address = formatAddress(invite.salon);
  const canRespond =
    currentUser &&
    invite.status === "pending" &&
    !invite.is_expired &&
    invite.salon.status === "active" &&
    invite.staff.is_active;
  const canCreateAccountFromInvite =
    !currentUser &&
    invite.status === "pending" &&
    !invite.is_expired &&
    invite.salon.status === "active" &&
    invite.staff.is_active &&
    !invite.target.has_account_target &&
    Boolean(invite.target.masked_email);

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-6 px-6 py-12">
      <div>
        <p className="text-sm font-medium text-zinc-500">Staff Invitation</p>
        <h1 className="mt-2 text-3xl font-semibold text-zinc-950">
          {invite.salon.name}
        </h1>
        {address ? <p className="mt-2 text-sm text-zinc-600">{address}</p> : null}
      </div>

      {connectionError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {connectionError}
        </p>
      ) : null}

      <section className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5">
        <div>
          <p className="text-sm text-zinc-500">Invited staff</p>
          <p className="mt-1 text-lg font-semibold text-zinc-950">
            {invite.staff.display_name}
          </p>
          <p className="mt-1 text-sm text-zinc-600">
            {invite.staff.job_title ?? "Staff"}
          </p>
          <p className="mt-3 text-sm text-zinc-600">
            {invite.salon.name} has prepared this staff profile for you.{" "}
            {currentUser
              ? "Accept it to connect your account to this salon."
              : "Verify the invited email and create a password to connect your staff account automatically."}
          </p>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium text-zinc-500">Status</dt>
            <dd className="mt-1 text-zinc-950">{invite.status}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-500">Expires</dt>
            <dd className="mt-1 text-zinc-950">
              {formatDateTime(invite.expires_at)}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-500">Email</dt>
            <dd className="mt-1 text-zinc-950">
              {invite.target.masked_email ?? "Not provided"}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-500">Phone</dt>
            <dd className="mt-1 text-zinc-950">
              {invite.target.masked_phone ?? "Not provided"}
            </dd>
          </div>
        </dl>

        {canCreateAccountFromInvite && invite.target.masked_email ? (
          <StaffInviteSignupForm
            maskedEmail={invite.target.masked_email}
            token={token}
          />
        ) : !currentUser ? (
          <div className="flex flex-wrap gap-3 border-t border-zinc-200 pt-4">
            {invite.target.has_account_target ? (
              <p className="basis-full text-sm text-zinc-600">
                This invite was sent to an existing Reylumi account. Log in with
                that account to accept it.
              </p>
            ) : (
              <p className="basis-full text-sm text-zinc-600">
                This invite needs an account before it can be accepted.
              </p>
            )}
            <Link
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
              href={`/login?next=${encodeURIComponent(nextPath)}`}
            >
              Login
            </Link>
            {!invite.target.has_account_target ? (
              <Link
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
                href={`/signup?next=${encodeURIComponent(nextPath)}`}
              >
                Create account
              </Link>
            ) : null}
          </div>
        ) : canRespond ? (
          <div className="flex flex-wrap gap-3 border-t border-zinc-200 pt-4">
            <form action={acceptStaffInviteTokenFormAction}>
              <input name="token" type="hidden" value={token} />
              <button
                className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
                type="submit"
              >
                Accept invitation
              </button>
            </form>
            <form action={declineStaffInviteTokenFormAction}>
              <input name="token" type="hidden" value={token} />
              <button
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
                type="submit"
              >
                Decline
              </button>
            </form>
          </div>
        ) : (
          <p className="border-t border-zinc-200 pt-4 text-sm text-zinc-600">
            This invitation cannot be accepted because it is no longer pending,
            the salon is inactive, or the staff profile is inactive.
          </p>
        )}
      </section>
    </main>
  );
}
