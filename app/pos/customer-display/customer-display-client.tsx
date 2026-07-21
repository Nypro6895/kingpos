"use client";

import { useEffect, useRef, useState } from "react";
import { getPosLiveDraft } from "@/app/pos/actions";
import type { PosLiveDraftView } from "@/types/pos-desk";

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amount);
}

export function CustomerDisplayClient({ token }: { token: string }) {
  const [liveDraft, setLiveDraft] = useState<PosLiveDraftView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef<number | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    let isMounted = true;

    async function loadDraft() {
      const result = await getPosLiveDraft(token);

      if (!isMounted) {
        return;
      }

      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (!result.data) {
        return;
      }

      if (versionRef.current === result.data.version) {
        return;
      }

      versionRef.current = result.data.version;
      setLiveDraft(result.data);
    }

    void loadDraft();
    const intervalId = window.setInterval(() => {
      void loadDraft();
    }, 1000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [token]);

  const visibleLines = liveDraft?.staff_lines ?? [];
  const showWaiting = visibleLines.length === 0;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-48px)] max-w-5xl flex-col gap-5">
      <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-center">
        <p className="text-sm uppercase tracking-wide text-emerald-300">
          KingPOS Promotion
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-normal">
          Fresh sets, clean turns, happy hands.
        </h1>
        <p className="mt-3 text-zinc-300">
          Ask the front desk about today&apos;s salon offers.
        </p>
      </section>

      <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-5">
        {liveDraft?.customer ? (
          <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-4">
            <p className="text-sm text-emerald-200">Welcome</p>
            <p className="text-2xl font-semibold text-white">
              {liveDraft.customer.name}
            </p>
            {liveDraft.customer.phone ? (
              <p className="mt-1 text-zinc-300">{liveDraft.customer.phone}</p>
            ) : null}
          </div>
        ) : (
          <p className="rounded border border-zinc-800 bg-zinc-950 p-4 text-zinc-400">
            Waiting for customer information from the front desk.
          </p>
        )}

        {error ? (
          <p className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-200">
            {error}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-400">Live Draft Receipt</p>
            <h2 className="text-3xl font-semibold tracking-normal">Receipt</h2>
          </div>
          <p className="rounded bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
            {liveDraft?.status ?? "waiting"}
          </p>
        </div>

        <div className="space-y-3">
          {showWaiting ? (
            <p className="rounded border border-dashed border-zinc-700 p-8 text-center text-zinc-400">
              Waiting for the front desk to start your receipt.
            </p>
          ) : (
            visibleLines.map((line) => (
              <div
                className="flex items-start justify-between gap-4 rounded border border-zinc-800 bg-zinc-950 p-4"
                key={line.id}
              >
                <div>
                  <p className="font-medium text-zinc-100">{line.label}</p>
                  <p className="mt-1 text-zinc-400">{line.staffName}</p>
                </div>
                <p className="text-xl font-semibold">
                  {formatMoney(line.amount)}
                </p>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 space-y-3 border-t border-zinc-700 pt-4">
          <div className="flex justify-between text-lg">
            <span className="text-zinc-300">Subtotal</span>
            <span className="font-semibold">
              {formatMoney(liveDraft?.subtotal ?? 0)}
            </span>
          </div>
          <div className="flex justify-between text-lg">
            <span className="text-zinc-300">Tip</span>
            <span className="font-semibold">
              {formatMoney(liveDraft?.tip ?? 0)}
            </span>
          </div>
          {(liveDraft?.subtotal ?? 0) > 0 ? (
            <div className="rounded border border-zinc-800 bg-zinc-950 p-3 text-center text-zinc-400">
              Tip options will appear during checkout.
            </div>
          ) : null}
          <div className="flex justify-between text-2xl font-semibold">
            <span>Total</span>
            <span>{formatMoney(liveDraft?.total ?? 0)}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
