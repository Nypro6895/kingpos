"use client";

import type { PlaceRequest } from "@/types/my-place";
import { button, primaryButton } from "./place-ui";

const labels: Record<PlaceRequest["kind"], string> = {
  invitation: "Invitation to join",
  application: "Your application",
  review: "Staff application",
  sent_invitation: "Invitation sent",
  account_invitation: "Business account invitation",
};

export function RequestRow({
  request: r,
  disabled,
  pending,
  onAction,
}: {
  request: PlaceRequest;
  disabled: boolean;
  pending: boolean;
  onAction: (id: string, operation: string) => void;
}) {
  const actions =
    r.kind === "invitation"
      ? [
          ["Accept", "accept_invite"],
          ["Decline", "decline_invite"],
        ]
      : r.kind === "account_invitation"
        ? [
            ["Accept", "accept_account"],
            ["Decline", "decline_account"],
          ]
        : r.kind === "review"
          ? [
              ["Approve", "approve_application"],
              ["Decline", "decline_application"],
            ]
          : r.kind === "application"
            ? [["Withdraw", "cancel_application"]]
            : [["Cancel invitation", "revoke_invite"]];
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-xs font-medium text-zinc-500">{labels[r.kind]}</p>
        <h3 className="mt-1 text-sm font-bold">{r.label}</h3>
        {r.detail ? (
          <p className="mt-1 break-words text-sm text-zinc-600">{r.detail}</p>
        ) : null}
        <details className="mt-2 text-xs text-zinc-500">
          <summary className="cursor-pointer">Request details</summary>
          <p className="mt-2">
            Sent{" "}
            {new Date(r.createdAt).toLocaleDateString("en-US", {
              timeZone: "UTC",
            })}
            {r.expiresAt
              ? ` · Expires ${new Date(r.expiresAt).toLocaleDateString("en-US", { timeZone: "UTC" })}`
              : ""}
          </p>
          {r.message ? (
            <p className="mt-2 whitespace-pre-wrap break-words">{r.message}</p>
          ) : null}
          {r.kind === "account_invitation" ? (
            <p className="mt-2">
              Accept to join this business account with the role shown above.
            </p>
          ) : null}
        </details>
      </div>
      {r.status === "pending" ? (
        <div className="flex flex-wrap gap-2">
          {actions.map(([label, operation], i) => (
            <button
              key={operation}
              disabled={disabled}
              className={actions.length > 1 && i === 0 ? primaryButton : button}
              onClick={() => onAction(r.id, operation)}
            >
              {pending ? "Updating…" : label}
            </button>
          ))}
        </div>
      ) : (
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium capitalize text-zinc-600">
          {r.status}
        </span>
      )}
    </div>
  );
}
