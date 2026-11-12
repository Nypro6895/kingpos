"use client";
import { useScopedMarketActions } from "./scoped-market-client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MARKET_TRIAL_PLUGINS } from "@/lib/market-access";
import { refreshMarketExperience } from "@/lib/refresh-market-experience";

type TrialState = {
  started: boolean;
  active: boolean;
  endsAt: string | null;
  paid: boolean;
};
type TrialView = {
  identity: string;
  state?: TrialState;
  busy: boolean;
  message: string;
};

export function MarketTrialPanel({
  pluginId,
  scope,
  salonId,
  accessRevision,
  onMarketRefresh,
  ready = true,
}: {
  pluginId: string;
  scope?: string;
  salonId?: string;
  accessRevision?: string;
  onMarketRefresh?: () => void;
  ready?: boolean;
}) {
  const { marketTrialAction } = useScopedMarketActions(salonId);

  const router = useRouter();
  const nativeGeneration =
    typeof window === "undefined"
      ? undefined
      : window.__reylumiAppLocalContext?.generation;
  const identity = JSON.stringify([pluginId, scope, salonId, nativeGeneration]);
  const [view, setView] = useState<TrialView>({
    identity,
    busy: false,
    message: "",
  });
  const { state, busy, message } =
    view.identity === identity
      ? view
      : { state: undefined, busy: false, message: "" };
  const alive = useRef(false),
    generation = useRef(0),
    readSequence = useRef(0),
    pending = useRef<number | null>(null);
  useEffect(() => {
    alive.current = true;
    generation.current += 1;
    pending.current = null;
    return () => {
      alive.current = false;
      generation.current += 1;
      readSequence.current += 1;
      pending.current = null;
    };
  }, [identity]);
  useEffect(() => {
    const epoch = generation.current,
      request = ++readSequence.current;
    const current = () =>
      alive.current &&
      generation.current === epoch &&
      readSequence.current === request &&
      pending.current === null &&
      nativeGeneration === window.__reylumiAppLocalContext?.generation;
    const failedRead = (error?: string) => {
      // A foreground read can race renewed native admission. Keep only this
      // identity's last verified display; the next verified revision reads
      // again. A failed read never restarts a trial or grants new access.
      if (current())
        setView((previous) => ({
          identity,
          state: previous.identity === identity ? previous.state : undefined,
          busy: false,
          message:
            previous.identity === identity && previous.state
              ? "Trial status could not refresh. Showing the last verified status."
              : (error ??
                "Trial access could not load. Reopen this plugin to retry."),
        }));
    };
    void marketTrialAction(pluginId, false, salonId)
      .then((result) => {
        if (!result.state) {
          failedRead(result.error);
          return;
        }
        if (current())
          setView({
            identity,
            state: result.state,
            busy: false,
            message: result.error ?? "",
          });
      })
      .catch(() => failedRead());
    return () => {
      readSequence.current += 1;
    };
  }, [pluginId, salonId, identity, accessRevision, nativeGeneration, marketTrialAction]);
  if (!MARKET_TRIAL_PLUGINS.some((id) => id === pluginId)) return null;
  async function start() {
    if (!ready || pending.current !== null || !alive.current) return;
    const epoch = generation.current,
      current = () =>
        alive.current &&
        generation.current === epoch &&
        nativeGeneration === window.__reylumiAppLocalContext?.generation;
    pending.current = epoch;
    readSequence.current += 1;
    setView({ identity, state, busy: true, message: "" });
    try {
      const result = await marketTrialAction(pluginId, true, salonId);
      if (!current()) return;
      readSequence.current += 1;
      setView({
        identity,
        state: result.state,
        busy: false,
        message: result.error ?? "Trial access updated.",
      });
      if (result.activationHref) {
        router.push(result.activationHref);
        router.refresh();
      }
      if (result.state) {
        refreshMarketExperience({
          scope,
          refresh: onMarketRefresh,
          fallback: () => router.refresh(),
          allResources: true,
        });
      }
    } catch {
      if (current()) {
        readSequence.current += 1;
        setView({
          identity,
          state,
          busy: false,
          message: "Trial access could not be updated. Please retry.",
        });
      }
    } finally {
      if (pending.current === epoch) pending.current = null;
    }
  }
  return (
    <section aria-label="Free trial">
      <p>
        Try this plugin free for 5 days, once per salon. No card required. No
        automatic renewal.
      </p>
      {state?.paid ? (
        <p>Paid access is active.</p>
      ) : state?.started ? (
        <p>
          {state.active ? "Trial active until " : "Trial ended on "}
          {state.endsAt
            ? new Date(state.endsAt).toLocaleString()
            : "this salon"}
          .
        </p>
      ) : (
        <button
          type="button"
          disabled={busy || !state || !ready}
          onClick={start}
        >
          {busy ? "Starting trial…" : "Start 5-day free trial"}
        </button>
      )}
      {!ready && !state?.started && !state?.paid && (
        <p>Trial access is being configured. Please try again later.</p>
      )}
      {pluginId === "booksms" && (
        <p>
          Includes up to 10 SMS sends per UTC calendar month during the trial.
          Configure your own Twilio sender; provider charges still apply.
        </p>
      )}
      {pluginId === "booking-deposit" && (
        <p>
          Connect your salon’s Stripe account before collecting customer
          payments. Processing fees still apply.
        </p>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
