"use client";

import { useState } from "react";

export function CopyInviteLinkButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(value);
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
