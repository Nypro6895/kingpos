"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ActionFeedback } from "@/components/action-feedback";
import { ReylumiIcon } from "@/components/reylumi-icons";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { sharePostLink } from "@/lib/post-share";

export function PostShareButton({ href, title = "Reylumi" }: { href: string; title?: string }) {
  const translate = useWorkspaceTranslation();
  const [message, setMessage] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      busy.current = false;
      setPending(false);
      setManualUrl("");
    };
  }, []);
  async function share() {
    if (busy.current || !mounted.current) return;
    busy.current = true;
    const attempt = ++generation.current;
    setPending(true);
    setMessage("");
    setManualUrl("");
    try {
      const result = await sharePostLink(href, title);
      if (mounted.current && generation.current === attempt) {
        if (result.status === "copied") setMessage("Link copied.");
        if (result.status === "manual") setManualUrl(result.url);
      }
    } catch (error) {
      if (mounted.current && generation.current === attempt && !(error instanceof Error && error.name === "AbortError")) setMessage("Could not share this link. Please try again.");
    } finally {
      if (mounted.current && generation.current === attempt) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  return <span className="relative inline-flex min-w-0">
    <button type="button" aria-label={translate("Share post")} title={translate("Share")} disabled={pending} aria-busy={pending} onClick={() => void share()}>
      <ActionFeedback pending={pending} pendingLabel="Sharing…"><ReylumiIcon name="share" /><span><WorkspaceText text="Share" /></span></ActionFeedback>
    </button>
    {message ? <span role="status" className="absolute bottom-full right-0 z-30 mb-2 w-48 rounded-lg bg-zinc-900 p-2 text-xs text-white shadow-lg"
      onClick={() => setMessage("")}><WorkspaceText text={message} /></span> : null}
    {manualUrl ? <span className="absolute bottom-full right-0 z-30 mb-2 w-64 rounded-lg bg-white p-2 shadow-lg"><label className="text-xs"><WorkspaceText text="Copy link" /><input aria-label={translate("Copy link")} className="w-full rounded border p-2" readOnly value={manualUrl} onFocus={event => event.currentTarget.select()} /></label></span> : null}
  </span>;
}
