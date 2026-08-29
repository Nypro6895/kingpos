"use client";

import { recordVisitExperienceAction } from "@/app/activity/actions";
import { useState, useTransition, type FormEvent } from "react";

type VisitExperiencePromptProps = {
  compact?: boolean;
  countsTowardReputation: boolean;
  initialBody?: string | null;
  initialState?: "good" | "issue" | null;
  salonName: string;
  ticketId: string;
  windowDays: number;
};

function stateLabel(state: "good" | "issue") {
  return state === "issue" ? "Issue shared" : "Good shared";
}

export function VisitExperiencePrompt({
  compact = false,
  countsTowardReputation,
  initialBody = null,
  initialState = null,
  salonName,
  ticketId,
  windowDays,
}: VisitExperiencePromptProps) {
  const [body, setBody] = useState(initialBody ?? "");
  const [draftState, setDraftState] = useState<"issue" | null>(null);
  const [savedState, setSavedState] = useState<"good" | "issue" | null>(
    initialState,
  );
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  function save(feedbackState: "good" | "issue", nextBody = body) {
    startTransition(async () => {
      setStatus("");

      const result = await recordVisitExperienceAction({
        body: nextBody,
        feedbackState,
        ticketId,
      });

      if (result.error !== null) {
        setStatus(result.error);
        return;
      }

      setSavedState(feedbackState);
      setDraftState(null);
      setStatus(
        result.countsTowardReputation
          ? "Thanks. This Verified Visit is counted."
          : `Thanks. This visit is verified, but the reputation count already has a visit in this ${windowDays}-day window.`,
      );
    });
  }

  function submitIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save("issue");
  }

  if (savedState) {
    return (
      <section
        className={[
          "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900",
          compact ? "mt-3" : "",
        ].join(" ")}
      >
        <p className="font-extrabold">{stateLabel(savedState)}</p>
        <p className="mt-1 leading-5">
          {savedState === "issue"
            ? "The salon can use your note to understand what happened."
            : "Your quick feedback helps keep Experiences useful."}
        </p>
      </section>
    );
  }

  return (
    <section
      className={[
        "rounded-2xl border border-border-subtle bg-surface px-4 py-3 shadow-sm",
        compact ? "mt-3" : "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-brand-teal">
            Verified Visit
          </p>
          <h3 className="mt-1 text-sm font-extrabold text-text-primary">
            How was your experience?
          </h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-text-secondary">
            {countsTowardReputation
              ? `${salonName} can count this visit in reputation.`
              : `This visit is verified; reputation count allows one visit per ${windowDays} days.`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            className="inline-flex min-h-10 items-center rounded-full bg-brand-teal px-4 text-sm font-extrabold text-white transition hover:bg-brand-teal/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal disabled:opacity-60"
            disabled={isPending}
            onClick={() => save("good", "")}
            type="button"
          >
            Good
          </button>
          <button
            className="inline-flex min-h-10 items-center rounded-full bg-surface-muted px-4 text-sm font-extrabold text-text-primary ring-1 ring-border-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-60"
            disabled={isPending}
            onClick={() => setDraftState("issue")}
            type="button"
          >
            Had an issue
          </button>
        </div>
      </div>

      {draftState === "issue" ? (
        <form className="mt-3 grid gap-2" onSubmit={submitIssue}>
          <textarea
            className="min-h-24 resize-none rounded-xl border border-border-subtle bg-white px-3 py-2 text-sm leading-6 text-text-primary outline-none transition focus:border-brand-orange"
            maxLength={2000}
            onChange={(event) => setBody(event.currentTarget.value)}
            placeholder="Optional details"
            value={body}
          />
          <div className="flex items-center justify-between gap-3">
            <button
              className="text-sm font-bold text-text-secondary hover:text-text-primary"
              disabled={isPending}
              onClick={() => setDraftState(null)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-flex min-h-10 items-center rounded-full bg-brand-orange px-4 text-sm font-extrabold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-60"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Saving..." : "Share issue"}
            </button>
          </div>
        </form>
      ) : null}

      {status ? (
        <p aria-live="polite" className="mt-2 text-xs font-semibold text-text-secondary">
          {status}
        </p>
      ) : null}
    </section>
  );
}
