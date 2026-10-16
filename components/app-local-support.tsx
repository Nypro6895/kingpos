"use client";

import Link from "next/link";
import { WorkspaceText } from "@/components/workspace-language";
import { SupportRequestForm, SupportConversationPanel } from "@/app/support/support-ui";
import { supportStatus } from "@/lib/support-case-labels";
import type { AppLocalSupportData, AppLocalSupportCaseData } from "@/lib/app-local-platform-types";

/** The shipped request form and conversation panel keep their original server actions. */
export function AppLocalSupport({ data, from = "" }: { data: AppLocalSupportData; from?: string }) {
  const source = from.startsWith("/") && !from.startsWith("//") ? from.split("?")[0].slice(0, 500) : "";
  return <main className="mx-auto max-w-5xl px-4 py-6 sm:px-8"><header className="mb-6"><h1 className="text-xl font-semibold"><WorkspaceText text="Report / Contact" /></h1><p className="mt-1 text-sm text-zinc-500"><WorkspaceText text="Ask for help and continue conversations with our team." /></p></header><p className="mb-6 text-sm"><Link href="/help" className="font-semibold text-orange-800 underline underline-offset-4"><WorkspaceText text="Browse the Help guides" /></Link></p>
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><section><h2 className="mb-4 font-semibold"><WorkspaceText text="Send a request" /></h2><SupportRequestForm source={source} category={source.includes("payroll") || source.includes("reports") ? "data_calculation" : source.includes("booking") ? "booking" : source.includes("ticket") || source.includes("pos") ? "ticket" : "app_issue"} /></section><section><h2 className="mb-4 font-semibold"><WorkspaceText text="My requests" /></h2><div className="grid gap-2">{data.cases.length ? data.cases.map(item => <Link key={item.id} href={`/support/${item.id}`} className="rounded-xl border border-zinc-200 p-4 hover:bg-zinc-50"><span className="block break-words text-sm font-semibold">{item.summary}</span><span className="text-xs text-zinc-500">{item.reference} · <WorkspaceText text={supportStatus[item.status] || item.status} /></span></Link>) : <p className="text-sm text-zinc-500"><WorkspaceText text="Your requests and replies will appear here." /></p>}</div></section></div>
  </main>;
}
export function AppLocalSupportConversation({ data, refresh }: { data: AppLocalSupportCaseData; refresh: () => Promise<void> }) {
  return <main className="mx-auto max-w-3xl px-4 py-6 sm:px-8"><Link href="/support" className="mb-5 inline-block text-sm text-orange-700"><WorkspaceText text="← Help & support" /></Link><SupportConversationPanel conversation={data.conversation} canReply={data.conversation.can_reply !== false} onRefresh={refresh} /></main>;
}
