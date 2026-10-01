"use client";

import { acceptOwnerTransferInviteAction } from "@/app/account/actions";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type OwnerTransferAcceptancePanelProps = {
  token: string;
};

export function OwnerTransferAcceptancePanel({
  token,
}: OwnerTransferAcceptancePanelProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function acceptInvite() {
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await acceptOwnerTransferInviteAction({ token });

      if (result.error) {
        setError(result.error);
        return;
      }

      setMessage(result.message ?? "Owner invitation accepted.");
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-[var(--shadow-soft)]">
      <h1 className="text-2xl font-extrabold text-text-primary">
        Owner invitation
      </h1>
      <p className="mt-2 text-sm font-medium leading-6 text-text-secondary">
        Review and accept this salon ownership invitation.
      </p>
      <div className="mt-5">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
          disabled={pending}
          onClick={acceptInvite}
          type="button"
        >
          {pending ? "Accepting..." : "Accept owner invitation"}
        </button>
      </div>
      {error ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {message}
        </p>
      ) : null}
    </section>
  );
}
