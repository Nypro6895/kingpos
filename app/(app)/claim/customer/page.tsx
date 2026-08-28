import { connectCustomerHistory } from "@/app/claim/customer/actions";
import { getCustomerClaimPreview } from "@/lib/customer-identity-claims";
import { getCurrentKingUser } from "@/lib/users/current-user";
import Link from "next/link";
import { redirect } from "next/navigation";

type CustomerClaimPageProps = {
  searchParams: Promise<{
    status?: string | string[];
    token?: string | string[];
  }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function claimPath(token: string | null) {
  return token ? `/claim/customer?token=${encodeURIComponent(token)}` : "/claim/customer";
}

function StatusState({ status }: { status: string }) {
  const states: Record<
    string,
    {
      eyebrow: string;
      heading: string;
      tone: "error" | "success";
      body: string;
    }
  > = {
    already_connected: {
      body: "This visit was already connected to your ReyLUMI profile.",
      eyebrow: "History",
      heading: "You are connected",
      tone: "success",
    },
    connected: {
      body: "Your salon history is now connected to your ReyLUMI profile.",
      eyebrow: "History",
      heading: "Visit connected",
      tone: "success",
    },
    conflict: {
      body: "This visit cannot be connected to this account. The record may already be linked.",
      eyebrow: "Claim unavailable",
      heading: "We could not connect this visit",
      tone: "error",
    },
    error: {
      body: "Customer history could not be connected right now.",
      eyebrow: "Claim unavailable",
      heading: "Try again later",
      tone: "error",
    },
    expired: {
      body: "Ask the salon for a fresh QR code if you still want to connect this visit.",
      eyebrow: "Claim expired",
      heading: "This QR code expired",
      tone: "error",
    },
    invalid: {
      body: "Ask the salon for a fresh QR code if you still want to connect this visit.",
      eyebrow: "Claim unavailable",
      heading: "This link is not valid",
      tone: "error",
    },
    used: {
      body: "Each QR code can only be used once. Open Activity to check your connected visits.",
      eyebrow: "Claim used",
      heading: "This QR code was already used",
      tone: "error",
    },
  };
  const state = states[status] ?? states.error;
  const success = state.tone === "success";

  return (
    <section
      className={[
        "mx-auto grid w-full max-w-md gap-5 rounded-2xl border bg-white p-6 text-center shadow-sm",
        success ? "border-emerald-200" : "border-amber-200",
      ].join(" ")}
    >
      <div>
        <p
          className={[
            "text-xs font-bold uppercase",
            success ? "text-emerald-700" : "text-amber-700",
          ].join(" ")}
        >
          {state.eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-extrabold text-text-primary">
          {state.heading}
        </h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-text-secondary">
          {state.body}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand-orange-hover"
          href="/activity"
        >
          Open Activity
        </Link>
        {!success ? (
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-subtle px-4 text-sm font-bold text-text-primary transition hover:border-brand-orange/50"
            href="/account"
          >
            Account
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <StatusState status={message === "expired" ? "expired" : "invalid"} />
  );
}

export default async function CustomerClaimPage({
  searchParams,
}: CustomerClaimPageProps) {
  const params = await searchParams;
  const token = firstParam(params.token)?.trim() ?? null;
  const status = firstParam(params.status)?.trim() ?? null;
  const user = await getCurrentKingUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(claimPath(token))}`);
  }

  if (status) {
    return (
      <main className="min-h-screen bg-surface-muted px-4 py-12 sm:px-6 lg:px-8">
        <StatusState status={status} />
      </main>
    );
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-surface-muted px-4 py-12 sm:px-6 lg:px-8">
        <ErrorState message="invalid" />
      </main>
    );
  }

  const preview = await getCustomerClaimPreview(token);

  if (!preview.ok) {
    return (
      <main className="min-h-screen bg-surface-muted px-4 py-12 sm:px-6 lg:px-8">
        <StatusState
          status={
            preview.code === "expired_token"
              ? "expired"
              : preview.code === "token_used"
                ? "used"
                : preview.code === "customer_unavailable" ||
                    preview.code === "phone_conflict"
                  ? "conflict"
                  : "invalid"
          }
        />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto grid w-full max-w-md gap-5 rounded-2xl border border-border-subtle bg-white p-6 shadow-sm">
        <div>
          <p className="text-xs font-bold uppercase text-brand-orange">
            ReyLUMI history
          </p>
          <h1 className="mt-2 text-2xl font-extrabold text-text-primary">
            Connect this visit?
          </h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-text-secondary">
            Save receipts and salon activity from {preview.data.salonName} to
            your ReyLUMI profile.
          </p>
        </div>

        {preview.data.alreadyLinked ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            This visit is already connected to your profile.
          </p>
        ) : null}

        <form action={connectCustomerHistory} className="grid gap-3">
          <input name="token" type="hidden" value={token} />
          <button
            className="min-h-12 rounded-full bg-brand-orange px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-orange-hover"
            type="submit"
          >
            Connect history
          </button>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-subtle px-4 text-sm font-bold text-text-primary transition hover:border-brand-orange/50"
            href="/activity"
          >
            Not now
          </Link>
        </form>
      </section>
    </main>
  );
}
