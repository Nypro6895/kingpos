"use client";
import { WorkspaceText } from "@/components/workspace-language";
import Link from "next/link";
export default function SupportError({reset}:{reset:()=>void}) {
 return <main className="mx-auto max-w-3xl p-6"><h1 className="text-lg font-semibold"><WorkspaceText text="Support is temporarily unavailable" /></h1><p className="my-3 text-sm text-zinc-600"><WorkspaceText text="Please try again. Your existing requests are saved." /></p><div className="flex flex-wrap gap-4 text-sm"><button onClick={reset} className="rounded-lg border px-4 py-2"><WorkspaceText text="Try again" /></button><Link href="/contact-support" className="self-center text-orange-700 underline"><WorkspaceText text="Contact support" /></Link></div></main>;
}
