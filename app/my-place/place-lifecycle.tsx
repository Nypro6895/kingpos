"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useEffect, useState, useTransition } from "react";
import { getPlaceLifecycleReview, setPlaceSalonActivity } from "./actions";
import {
  FormFooter,
  LoadState,
  Notice,
  Sheet,
  inputClass,
  readForm,
} from "./place-ui";
import type { CurrentWorkspaceOption } from "@/lib/current-context";

type Review = Extract<
  Awaited<ReturnType<typeof getPlaceLifecycleReview>>,
  { ok: true }
>["data"];

export function PlaceLifecyclePanel({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: CurrentWorkspaceOption;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const __vt = useWorkspaceTranslation();

  const [dirty, setDirty] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  async function load() {
    setError(null);
    try {
      const result = await getPlaceLifecycleReview(workspace.id);
      if (result.ok) setReview(result.data);
      else setError(result.message);
    } catch {
      setError("Unable to check salon status. Please try again.");
    }
  }
  useEffect(() => {
    let cancelled = false;
    getPlaceLifecycleReview(workspace.id)
      .then((result) => {
        if (!cancelled) {
          if (result.ok) setReview(result.data);
          else setError(result.message);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Unable to check salon status.");
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.id]);
  const pause = review?.status === "active";
  return (
    <Sheet
      title={__vt("Salon activity")}
      subtitle={__vt(workspace.label)}
      busy={busy}
      dirty={dirty}
      onClose={onClose}
    >
      {!review ? (
        <LoadState error={error ?? undefined} retry={() => void load()} />
      ) : (
        <form
          onChange={() => setDirty(true)}
          className="grid gap-4"
          onSubmit={(event) => {
            const form = readForm(event);
            start(async () => {
              setError(null);
              try {
                const result = await setPlaceSalonActivity(workspace.id, form);
                if (!result.ok) setError(result.message);
                else {
                  onSaved(
                    pause
                      ? "Salon temporarily paused. Historical data remains available."
                      : "Salon reactivated.",
                  );
                  onClose();
                }
              } catch {
                setError("Unable to change salon activity. Please try again.");
              }
            });
          }}
        >
          <input
            type="hidden"
            name="operation"
            value={pause ? "pause" : "resume"}
          />
          <h3 className="font-semibold">
            <WorkspaceText text={pause ? "Temporarily pause this salon?" : "Reactivate this salon?"} />
          </h3>
          <p className="text-sm leading-6 text-zinc-600">
            <WorkspaceText text={pause
              ? "This pauses business activity, including new bookings and POS tickets. Operational edits are restricted. History and permitted settings remain available. Existing appointments are not automatically cancelled."
              : "Business activity can resume with the salon’s existing settings. Working hours and online booking preferences are kept."} />
          </p>
          <p className="text-sm text-zinc-500">
            <WorkspaceText text="This is separate from opening and closing hours." />
          </p>
          {pause ? (
            <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold"><WorkspaceText text="Current work" /></p>
              <ul className="mt-2 list-inside list-disc">
                <li>{review.counts.futureBookings} <WorkspaceText text="upcoming appointments" /></li>
                <li>
                  {review.counts.pendingBookings} <WorkspaceText text="pending / in-progress appointments" />
                </li>
                <li>{review.counts.openPosTickets} <WorkspaceText text="open POS tickets" /></li>
              </ul>
              <p className="mt-2">
                <WorkspaceText text="Review unfinished work before pausing. Appointment counts may overlap." />
              </p>
            </div>
          ) : null}
          <fieldset className="grid gap-4" disabled={busy}>
            <label className="grid gap-2 text-sm font-medium">
              <WorkspaceText text="Reason (optional)" />
              <textarea
                className={inputClass}
                name="reason"
                maxLength={1000}
                rows={2}
              />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                name="acknowledged"
                required
              />
              <span>
                <WorkspaceText text={pause
                  ? "I understand that business activity will be paused."
                  : "I confirm that business activity can resume."} />
              </span>
            </label>
          </fieldset>
          {error ? <Notice error><WorkspaceText text={error} /></Notice> : null}
          <FormFooter
            busy={busy}
            label={__vt(pause ? "Pause salon" : "Reactivate salon")}
          />
        </form>
      )}
    </Sheet>
  );
}
