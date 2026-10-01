"use client";

import { useState } from "react";

function resolveInviteUrl(value: string) {
  if (typeof window === "undefined") {
    return value;
  }

  return new URL(value, window.location.origin).toString();
}

export function CopyInviteLinkButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const resolvedValue = resolveInviteUrl(value);

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(resolvedValue);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = resolvedValue;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      className="inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-950"
      onClick={copyLink}
      type="button"
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

export function InviteLinkTools({ value }: { value: string }) {
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
          {showQr ? "Hide QR Code" : "Show QR Code"}
        </button>
        {qrValue ? (
          <div className="absolute right-0 z-10 mt-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Invite QR code"
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
