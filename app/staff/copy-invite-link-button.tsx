"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { ActionFeedback } from "@/components/action-feedback";
import { useEffect, useRef, useState } from "react";

function resolveInviteUrl(value: string) {
  if (typeof window === "undefined") {
    return value;
  }

  return new URL(value, window.location.origin).toString();
}

export function CopyInviteLinkButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const lifetime = useRef({ active: false, generation: 0, pending: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const state = lifetime.current;
    state.active = true;
    return () => {
      state.active = false; state.generation++; state.pending = false;
      if (timer.current) clearTimeout(timer.current);
      setCopying(false); setCopied(false); setError("");
    };
  }, [value]);

  async function copyLink() {
    const state = lifetime.current, generation = state.generation;
    if (!state.active || state.pending) return;
    const current = () => state.active && state.generation === generation;
    state.pending = true; setCopying(true); setCopied(false); setError("");
    if (timer.current) clearTimeout(timer.current);
    try {
      const resolvedValue = resolveInviteUrl(value);
      if (navigator.clipboard) await navigator.clipboard.writeText(resolvedValue);
      else {
        const textArea = document.createElement("textarea");
        textArea.value = resolvedValue; textArea.style.position = "fixed"; textArea.style.opacity = "0";
        document.body.appendChild(textArea); textArea.select();
        try { if (!document.execCommand("copy")) throw Error("Copy unavailable"); }
        finally { textArea.remove(); }
      }
      if (current()) { setCopied(true); timer.current = setTimeout(() => { if (current()) setCopied(false); }, 2000); }
    } catch { if (current()) setError("Could not copy the link. Please try again."); }
    finally { if (current()) { state.pending = false; setCopying(false); } }
  }

  return (
    <><button
      className="inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-950"
      onClick={copyLink}
      disabled={copying}
      aria-busy={copying}
      type="button"
    >
      <ActionFeedback pending={copying} pendingLabel="Copying…">{copied ? "Copied" : <WorkspaceText text="Copy link" />}</ActionFeedback>
    </button>{error ? <span role="alert" className="text-sm text-red-700"><WorkspaceText text={error} /></span> : null}</>
  );
}

export function InviteLinkTools({ value }: { value: string }) {
  const __vt = useWorkspaceTranslation();

  const [qrValue, setQrValue] = useState<string | null>(null);
  const showQr = Boolean(qrValue);

  return (
    <div className="flex flex-wrap items-start gap-2">
      <CopyInviteLinkButton value={value} />
      <div className="relative">
        <button
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-950"
          onClick={() =>
            setQrValue((current) => (current ? null : resolveInviteUrl(value)))
          }
          type="button"
        >
          <WorkspaceText text={showQr ? "Hide QR Code" : "Show QR Code"} />
        </button>
        {qrValue ? (
          <div className="absolute right-0 z-10 mt-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={__vt("Invite QR code")}
              className="size-40"
              height={160}
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                qrValue,
              )}`}
              width={160}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
