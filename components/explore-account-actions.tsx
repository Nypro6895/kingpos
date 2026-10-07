"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { AuthIntentPrompt } from "@/components/auth-intent-prompt";
import { ReylumiIcon } from "@/components/reylumi-icons";
import { openQuickBooking } from "@/lib/quick-booking-client";
import {
  salonLoveAction,
  referenceLoveAction,
} from "@/app/explore/account-actions";
import { setAccountSavedPostAction } from "@/app/saved-post/actions";
import type { AccountSavedPostTarget } from "@/types/saved-post";
type BookIntent = {
  href: string | null;
  name: string;
  contactHref?: string | null;
  phoneHref?: string | null;
};
type Intent =
  | { kind: "book"; book: BookIntent }
  | { kind: "save"; target: AccountSavedPostTarget }
  | { kind: "salon"; salonId: string }
  | { kind: "reference"; itemKey: string };
const Auth = createContext(false);
export function useExploreAuthenticated() {
  return useContext(Auth);
}
const KEY = "reylumi-explore-account-intent";
export function clearExploreIntent() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
export function rememberExploreIntent(intent: Intent) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...intent, at: Date.now() }));
  } catch {}
}
export function ExploreAccountActionsProvider({
  authenticated,
  children,
}: {
  authenticated: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [contact, setContact] = useState<BookIntent | null>(null);
  const [message, setMessage] = useState("");
  const [authPrompt, setAuthPrompt] = useState(false);
  useEffect(() => {
    const show = (event: Event) =>
      setContact((event as CustomEvent<BookIntent>).detail);
    window.addEventListener("reylumi:contact-salon", show);
    const gate = (event: Event) => {
      const book = (event as CustomEvent<BookIntent>).detail;
      rememberExploreIntent({ kind: "book", book });
      setAuthPrompt(true);
    };
    window.addEventListener("reylumi:booking-auth-required", gate);
    if (authenticated && pathname.startsWith("/explore")) {
      try {
        const raw = sessionStorage.getItem(KEY);
        if (raw) {
          const intent = JSON.parse(raw) as Intent & { at: number };
          sessionStorage.removeItem(KEY);
          if (Date.now() - intent.at < 86400000) {
            if (intent.kind === "book") {
              if (intent.book.href)
                setTimeout(() => openQuickBooking(intent.book.href!), 0);
              else setTimeout(() => setContact(intent.book), 0);
            } else if (intent.kind === "reference") {
              void referenceLoveAction(intent.itemKey, true).then((result) =>
                setMessage(result.error ?? "Added to your favorites"),
              );
            } else if (intent.kind === "salon") {
              void salonLoveAction(intent.salonId, true).then((result) =>
                setMessage(result.error ?? "Salon added to your favorites ♡"),
              );
            } else if (intent.kind === "save") {
              void setAccountSavedPostAction(intent.target, true).then(
                (result) => {
                  setMessage(result.error ?? "Your look has been saved ♡");
                  window.dispatchEvent(
                    new CustomEvent("reylumi:saved-post-state-change", {
                      detail: {
                        key: `${intent.target.sourceType}:${intent.target.sourceId}`,
                        saved: result.active,
                      },
                    }),
                  );
                },
              );
            }
          }
        }
      } catch {}
    }
    return () => {
      window.removeEventListener("reylumi:contact-salon", show);
      window.removeEventListener("reylumi:booking-auth-required", gate);
    };
  }, [authenticated, pathname]);
  useEffect(() => {
    if (!contact) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContact(null);
    };
    document.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", close);
    };
  }, [contact]);
  return (
    <Auth.Provider value={authenticated}>
      {children}
      {authPrompt ? (
        <AuthIntentPrompt
          kicker="A little self-care"
          title="Your next beauty moment ✨"
          onClose={() => {
            setAuthPrompt(false);
            clearExploreIntent();
          }}
        >
          Create a free account or log in to book your next visit and keep your
          favorites together.
        </AuthIntentPrompt>
      ) : null}
      {message ? (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-[90] -translate-x-1/2 rounded-2xl bg-orange-50 p-4 shadow-xl"
        >
          {message}
          <button
            className="ml-3"
            onClick={() => setMessage("")}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}
      {contact
        ? createPortal(
            <div
              className="fixed inset-0 z-[96] grid place-items-center bg-zinc-950/40 p-5"
              onClick={() => setContact(null)}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-label="Contact salon"
                className="relative w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  autoFocus
                  aria-label="Close"
                  className="absolute right-4 top-3 text-2xl"
                  onClick={() => setContact(null)}
                >
                  ×
                </button>
                <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-orange-50 text-brand-orange">
                  <ReylumiIcon name="calendar" className="h-8 w-8" />
                </div>
                <h2 className="text-xl font-semibold">
                  Let’s connect with {contact.name}
                </h2>
                <p className="mt-3 text-sm leading-6 text-zinc-600">
                  This salon hasn’t enabled online booking yet. Contact the
                  salon directly to arrange your visit.
                </p>
                {contact.phoneHref ? (
                  <a
                    className="mt-5 block rounded-full bg-brand-orange p-3 font-semibold text-white"
                    href={contact.phoneHref}
                  >
                    Call salon
                  </a>
                ) : null}
                {contact.contactHref ? (
                  <a
                    className="mt-3 block rounded-full bg-orange-50 p-3 font-semibold text-brand-orange"
                    href={contact.contactHref}
                  >
                    View salon & contact details
                  </a>
                ) : null}
              </section>
            </div>,
            document.body,
          )
        : null}
    </Auth.Provider>
  );
}
export function ExploreBookButton({
  href,
  name = "this salon",
  contactHref,
  phoneHref,
  className = "",
  compact = false,
}: {
  href?: string | null;
  name?: string;
  contactHref?: string | null;
  phoneHref?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const authenticated = useContext(Auth);
  const [prompt, setPrompt] = useState(false);
  const destination =
    href && /^\/(?:book|booking)\/[0-9a-f-]{36}(?:[/?#]|$)/i.test(href)
      ? href
      : null;
  const book: BookIntent = { href: destination, name, contactHref, phoneHref };
  return (
    <>
      <button
        type="button"
        aria-label={`Book ${name}`}
        className={`inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full bg-brand-orange px-3 text-xs font-semibold text-white shadow-sm ${className}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!authenticated) {
            rememberExploreIntent({ kind: "book", book });
            setPrompt(true);
          } else if (destination) openQuickBooking(destination);
          else
            window.dispatchEvent(
              new CustomEvent("reylumi:contact-salon", { detail: book }),
            );
        }}
      >
        <ReylumiIcon name="calendar" className="h-4 w-4" />
        {!compact ? "Book" : null}
      </button>
      {prompt ? (
        <AuthIntentPrompt
          kicker="A little self-care"
          title="Your next beauty moment ✨"
          onClose={() => {
            setPrompt(false);
            try {
              sessionStorage.removeItem(KEY);
            } catch {}
          }}
        >
          Create a free account or log in to book your next visit and keep
          everything you love in one place.
        </AuthIntentPrompt>
      ) : null}
    </>
  );
}
export function ExploreSalonLove({
  salonId,
  name,
  className = "",
}: {
  salonId: string;
  name: string;
  className?: string;
}) {
  const authenticated = useContext(Auth);
  const [prompt, setPrompt] = useState(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!authenticated || !/^([0-9a-f-]{36})$/i.test(salonId)) return;
    let mounted = true;
    void salonLoveAction(salonId).then((result) => {
      if (mounted && !result.error) setActive(result.active);
    });
    return () => {
      mounted = false;
    };
  }, [authenticated, salonId]);
  if (salonId.startsWith("showcase-"))
    return (
      <ExploreReferenceLove
        itemKey={`salon:${salonId}`}
        name={name}
        className={className}
      />
    );
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Love ${name}`}
        aria-pressed={active}
        className={`inline-grid h-8 w-8 place-items-center rounded-full bg-white text-brand-orange shadow-sm ring-1 ring-orange-100 ${className}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!authenticated) {
            rememberExploreIntent({ kind: "salon", salonId });
            setPrompt(true);
            return;
          }
          setBusy(true);
          void salonLoveAction(salonId, !active)
            .then((result) => {
              if (result.error) setError(result.error);
              else setActive(result.active ?? false);
            })
            .finally(() => setBusy(false));
        }}
      >
        <span className="text-xl" aria-hidden>
          {active ? "♥" : "♡"}
        </span>
      </button>
      {error ? (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      ) : null}
      {prompt ? (
        <AuthIntentPrompt
          kicker="Made for your favorites"
          title="Keep this salon close ♡"
          onClose={() => {
            setPrompt(false);
            clearExploreIntent();
          }}
        >
          Create a free account or log in to follow {name} and find it again
          whenever you need a little self-care.
        </AuthIntentPrompt>
      ) : null}
    </>
  );
}

export function ExploreReferenceLove({
  itemKey,
  name,
  className = "",
}: {
  itemKey: string;
  name: string;
  className?: string;
}) {
  const authenticated = useContext(Auth);
  const [prompt, setPrompt] = useState(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!authenticated) return;
    let mounted = true;
    void referenceLoveAction(itemKey).then((result) => {
      if (mounted && !result.error) setActive(result.active);
    });
    return () => {
      mounted = false;
    };
  }, [authenticated, itemKey]);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Love ${name}`}
        aria-pressed={active}
        className={`inline-grid h-8 w-8 place-items-center rounded-full bg-white text-brand-orange shadow-sm ring-1 ring-orange-100 ${className}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!authenticated) {
            rememberExploreIntent({ kind: "reference", itemKey });
            setPrompt(true);
            return;
          }
          setBusy(true);
          void referenceLoveAction(itemKey, !active)
            .then((result) => {
              if (result.error) setError(result.error);
              else setActive(result.active);
            })
            .finally(() => setBusy(false));
        }}
      >
        <span aria-hidden className="text-xl">
          {active ? "\u2665" : "\u2661"}
        </span>
      </button>
      {error ? (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      ) : null}
      {prompt ? (
        <AuthIntentPrompt
          kicker="A little inspiration"
          title="Keep what you love"
          onClose={() => {
            setPrompt(false);
            clearExploreIntent();
          }}
        >
          Create a free account or log in to keep {name} in your favorites.
        </AuthIntentPrompt>
      ) : null}
    </>
  );
}
