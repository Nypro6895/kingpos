"use client";

import { useState } from "react";
import { ReylumiIcon } from "@/components/reylumi-icons";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";

export function PostShareButton({ href, title = "Reylumi" }: { href: string; title?: string }) {
  const translate = useWorkspaceTranslation();
  const [message, setMessage] = useState("");
  async function share() {
    setMessage("");
    try {
      const url = new URL(href, window.location.origin).href;
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        setMessage("Link copied.");
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) setMessage("Could not share this link. Please try again.");
    }
  }
  return <span className="relative inline-flex min-w-0">
    <button type="button" aria-label={translate("Share post")} title={translate("Share")} onClick={() => void share()}>
      <ReylumiIcon name="share" /><span><WorkspaceText text="Share" /></span>
    </button>
    {message ? <span role="status" className="absolute bottom-full right-0 z-30 mb-2 w-48 rounded-lg bg-zinc-900 p-2 text-xs text-white shadow-lg"
      onClick={() => setMessage("")}><WorkspaceText text={message} /></span> : null}
  </span>;
}
