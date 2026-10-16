"use client";
import { WorkspaceText } from "@/components/workspace-language";
import Link from "next/link";

/** Display only. Original server guards continue to authorize every action. */
export function AbuseNoticeView({ mode }: { mode: string | null }) {
  if (!mode) return null;
  const message = mode === "warn" ? "Please review our community rules before posting." : mode === "review" ? "Your posts and comments require review before they appear publicly." : mode === "challenge" ? "Complete a security check before posting again." : "Posting and reporting are temporarily restricted.";
  return <aside role="status" className="relative z-50 border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-950"><WorkspaceText text={message} /> {mode === "challenge" ? <Link href="/security-check" className="font-medium underline"><WorkspaceText text="Security check" /></Link> : <Link href="/contact-support" className="font-medium underline"><WorkspaceText text="Contact support" /></Link>}</aside>;
}
