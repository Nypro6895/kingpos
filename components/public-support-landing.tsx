"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import { translateHelp, type HelpLanguage } from "@/lib/help-language";

export function PublicSupportLanding({ children, language, navigate }: {
  children?: ReactNode;
  language?: HelpLanguage;
  navigate?: (href: string) => void;
}) {
  const workspaceText = useWorkspaceTranslation();
  const t = (text: string) => language ? translateHelp(text, language) : workspaceText(text);
  const follow = (href: string) => navigate ? (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  } : undefined;

  return <main lang={language} className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
    <header className="mb-6">
      <h1 className="text-xl font-semibold">{t("Support")}</h1>
      <p className="mt-1 text-sm text-zinc-500">{t("Report an issue and continue conversations with our team.")}</p>
    </header>
    <div className="grid gap-3">
      <Link href="/contact-support" className="text-orange-700 underline" onClick={follow("/contact-support")}>{t("Contact support without signing in")}</Link>
      {children}
      <Link href="/login?next=/support" className="underline" onClick={follow("/login?next=/support")}>{t("Sign in to view your requests")}</Link>
    </div>
  </main>;
}
