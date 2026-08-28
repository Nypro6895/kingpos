import {
  acceptBeautySalonPublicationRequestAction,
  declineBeautySalonPublicationRequestAction,
} from "@/app/salon-profile/client-transformations/actions";
import { ReviewActionButton } from "@/app/salon-profile/client-transformations/review-action-button";
import {
  listBeautySalonPublicationRequests,
  type BeautySalonPublicationMedia,
  type BeautySalonPublicationRequest,
} from "@/lib/beauty-salon-publications";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import Link from "next/link";

type ClientTransformationsPageProps = {
  searchParams: Promise<{
    error?: string;
    notice?: string;
  }>;
};

type VerificationTone = "muted" | "pending" | "verified";

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Recently";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatPostedTime(value: string | null | undefined) {
  if (!value) {
    return "recently";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "recently";
  }

  const elapsedMs = Date.now() - date.getTime();
  const elapsedMinutes = Math.max(0, Math.round(elapsedMs / 60000));

  if (elapsedMinutes < 2) {
    return "just now";
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} min ago`;
  }

  const elapsedHours = Math.round(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours} hr ago`;
  }

  const elapsedDays = Math.round(elapsedHours / 24);

  if (elapsedDays < 8) {
    return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
  }

  return formatDate(value);
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function pendingCountLabel(count: number) {
  return `${count} pending`;
}

function safeFeedbackMessage(
  value: string | null | undefined,
  fallback: string,
) {
  const message = value?.trim() ?? "";

  if (!message) {
    return "";
  }

  if (
    message === "Beauty transformation request could not be updated." ||
    message === "Beauty transformation request returned an invalid response." ||
    message.includes("NEXT_") ||
    message.includes("RPC") ||
    message.includes("Supabase") ||
    message.startsWith("Missing required permission:")
  ) {
    return fallback;
  }

  return message;
}

function safeLoadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.startsWith("Missing required permission:")) {
    return "You do not have permission to review client transformations.";
  }

  if (
    message === "Open a salon management workspace to review transformations." ||
    message === "Sign in before reviewing Beauty transformations."
  ) {
    return message;
  }

  return "Client transformations could not be loaded.";
}

function VerificationIcon({ tone }: { tone: VerificationTone }) {
  if (tone === "verified") {
    return (
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M20 6 9 17l-5-5" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    );
  }

  if (tone === "pending") {
    return (
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </svg>
  );
}

function VerificationBadge({
  state,
}: {
  state: BeautySalonPublicationRequest["verificationState"];
}) {
  const verified = state === "verified";
  const pending = state === "pending";
  const tone: VerificationTone = verified ? "verified" : pending ? "pending" : "muted";
  const label = verified
    ? "Verified visit"
    : pending
      ? "Visit verification pending"
      : "Not verified";
  const className = verified
    ? "text-emerald-700"
    : pending
      ? "text-amber-700"
      : "text-zinc-500";

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <VerificationIcon tone={tone} />
      <span>{label}</span>
    </span>
  );
}

function Notice({
  children,
  tone = "success",
}: {
  children: React.ReactNode;
  tone?: "danger" | "success";
}) {
  const className =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-800";

  return (
    <p
      aria-live={tone === "danger" ? "assertive" : "polite"}
      className={`rounded-lg border px-4 py-3 text-sm font-semibold ${className}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

function TransformationImage({
  authorName,
  label,
  media,
}: {
  authorName: string;
  label: string;
  media: BeautySalonPublicationMedia | undefined;
}) {
  return (
    <div className="relative aspect-[4/5] overflow-hidden bg-zinc-100">
      {media?.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${label} photo from ${authorName}'s transformation`}
          className="h-full w-full object-cover"
          loading="lazy"
          src={media.url}
        />
      ) : (
        <div
          aria-label={`${label} image unavailable`}
          className="grid h-full w-full place-items-center bg-zinc-100 text-xs font-semibold uppercase text-zinc-500"
          role="img"
        >
          {label}
        </div>
      )}
      <span className="absolute left-2 top-2 rounded-full bg-white/92 px-2.5 py-1 text-[11px] font-semibold uppercase text-zinc-800 shadow-sm ring-1 ring-zinc-200/70">
        {label}
      </span>
    </div>
  );
}

function CustomerAvatar({ request }: { request: BeautySalonPublicationRequest }) {
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-950 text-xs font-semibold text-white ring-1 ring-zinc-200">
      {request.authorAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${request.authorDisplayName} profile`}
          className="h-full w-full object-cover"
          loading="lazy"
          src={request.authorAvatarUrl}
        />
      ) : (
        initialsFor(request.authorDisplayName)
      )}
    </span>
  );
}

function RequestCard({
  request,
  salonName,
}: {
  request: BeautySalonPublicationRequest;
  salonName: string;
}) {
  const before =
    request.media.find((item) => item.role === "before") ?? request.media[0];
  const after =
    request.media.find((item) => item.role === "after") ??
    request.media.find((item) => item.id !== before?.id) ??
    request.media[1] ??
    before;
  const postedTime = formatPostedTime(request.postCreatedAt);

  return (
    <article className="overflow-hidden rounded-lg bg-white ring-1 ring-zinc-200">
      <div className="grid grid-cols-2 gap-px bg-zinc-200">
        <TransformationImage
          authorName={request.authorDisplayName}
          label="Before"
          media={before}
        />
        <TransformationImage
          authorName={request.authorDisplayName}
          label="After"
          media={after}
        />
      </div>
      <div className="grid gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <CustomerAvatar request={request} />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-zinc-950">
                {request.authorDisplayName}
              </h2>
              <p
                className="text-sm text-zinc-500"
                title={formatDate(request.postCreatedAt)}
              >
                Posted {postedTime}
              </p>
            </div>
          </div>
          <span className="w-fit rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600">
            Feature request
          </span>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-2 text-sm font-semibold text-zinc-600">
          <span>For {salonName}</span>
          {request.staffName ? <span>with {request.staffName}</span> : null}
          <VerificationBadge state={request.verificationState} />
        </div>

        {request.caption ? (
          <p className="whitespace-pre-wrap text-[15px] leading-7 text-zinc-800">
            {request.caption}
          </p>
        ) : null}

        <div className="grid gap-2 border-t border-zinc-100 pt-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
          <form action={acceptBeautySalonPublicationRequestAction}>
            <input
              name="publication_id"
              type="hidden"
              value={request.publicationId}
            />
            <ReviewActionButton
              idleLabel="Add to salon profile"
              pendingLabel="Adding..."
              variant="primary"
            />
          </form>
          <form action={declineBeautySalonPublicationRequestAction}>
            <input
              name="publication_id"
              type="hidden"
              value={request.publicationId}
            />
            <ReviewActionButton
              idleLabel="Keep off profile"
              pendingLabel="Keeping off..."
              variant="secondary"
            />
          </form>
        </div>
      </div>
    </article>
  );
}

function EmptyQueue() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-5 py-8 text-center">
      <h2 className="text-lg font-semibold text-zinc-950">
        You&apos;re all caught up
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
        New client transformations will appear here when customers tag your salon.
      </p>
    </div>
  );
}

export default async function ClientTransformationsPage({
  searchParams,
}: ClientTransformationsPageProps) {
  const [{ error, notice }, context] = await Promise.all([
    searchParams,
    requireSalonManagePageContext("/salon-profile/client-transformations"),
  ]);
  let requests: BeautySalonPublicationRequest[] = [];
  let loadError = "";
  let salonName = context.currentSalon.name;

  try {
    const result = await listBeautySalonPublicationRequests(context);
    requests = result.requests;
    salonName = result.salonName;
  } catch (caught) {
    loadError = safeLoadErrorMessage(caught);
  }

  const actionNotice = safeFeedbackMessage(
    notice,
    "Your review was saved.",
  );
  const actionError = safeFeedbackMessage(
    error,
    "Could not update this transformation. Please try again.",
  );

  return (
    <main className="min-h-screen overflow-x-hidden bg-zinc-50 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <section className="mx-auto grid max-w-3xl gap-4 sm:gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="w-fit rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-700">
            {pendingCountLabel(requests.length)}
          </span>
          <Link
            className="inline-flex min-h-10 w-fit items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
            href="/salon-profile"
          >
            Back to profile
          </Link>
        </div>

        {actionNotice ? <Notice>{actionNotice}</Notice> : null}
        {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
        {loadError ? <Notice tone="danger">{loadError}</Notice> : null}

        {requests.length > 0 ? (
          <div className="grid gap-4">
            {requests.map((request) => (
              <RequestCard
                key={request.publicationId}
                request={request}
                salonName={salonName}
              />
            ))}
          </div>
        ) : !loadError ? (
          <EmptyQueue />
        ) : null}
      </section>
    </main>
  );
}
