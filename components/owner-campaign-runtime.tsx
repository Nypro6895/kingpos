"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { dismissCampaignPromptAction, ownerCampaignPromptAction } from "@/app/campaigns/actions";
import { OwnerCampaignDialog } from "./owner-campaign-dialog";
import type { CampaignPrompt, OwnerCampaignSettings } from "@/types/owner-campaign";
import type { PostCommentTarget } from "@/types/post-comments";

export function OwnerCampaignRuntime({ scope, settings, location, availableCredits = 0 }: {
  availableCredits?: number; scope: string; settings: OwnerCampaignSettings;
  location: { city: string; state: string; country: string };
}) {
  const pathname = usePathname();
  const excluded = pathname.startsWith("/pos/portable") || pathname.startsWith("/admin");
  const [prompt, setPrompt] = useState<CampaignPrompt | null>(null);
  useEffect(() => {
    if (excluded || !settings.enabled) return;
    let alive = true;
    const check = () => { if (document.visibilityState !== "visible" || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return; void ownerCampaignPromptAction().then(result => { if (alive && result) setPrompt(result); }).catch(() => {}); };
    const timer = window.setTimeout(check, 2000);
    const published = () => window.setTimeout(check, 800);
    const manual = (event: Event) => { const target = (event as CustomEvent<PostCommentTarget>).detail; if (target?.salonId && scope.startsWith(`${target.salonId}:`)) setPrompt({ id: "manual", target }); };
    window.addEventListener("reylumi:post-published", published);
    window.addEventListener("reylumi:promote-post", manual);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener("reylumi:post-published", published); window.removeEventListener("reylumi:promote-post", manual); };
  }, [scope, pathname, excluded, settings.enabled]);
  if (excluded || !prompt) return null;
  return <OwnerCampaignDialog key={prompt.id} availableCredits={availableCredits} target={prompt.target} settings={settings} initialLocation={location} onClose={() => { if (prompt.id !== "manual") void dismissCampaignPromptAction(prompt.id).catch(() => {}); setPrompt(null); }} />;
}
