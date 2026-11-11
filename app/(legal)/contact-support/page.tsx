import { withExperiencePage } from "@/components/experience-page";
import Link from "next/link";
import type { Metadata } from "next";
import { ContactSupportForm } from "./contact-form";

export const metadata: Metadata = { title: "Contact Support · Reylumi", description: "Send a message to the Reylumi support team." };

async function ContactSupportPage({searchParams}:{searchParams:Promise<{topic?:string}>}) {
  const recovery=(await searchParams).topic==="account-recovery";
  return <main className="mx-auto grid w-full max-w-none gap-10 px-5 py-12 lg:grid-cols-[1fr_1.3fr] lg:py-20"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-orange-700">We are here to help</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Contact Support</h1><p className="mt-5 text-base leading-relaxed text-zinc-600">Have a question about your account, bookings or salon workspace? Tell us what happened and our support team will get back to you.</p><div className="mt-7 bg-zinc-50 p-5"><p className="text-sm font-medium">Reylumi support</p><p className="mt-3 text-sm leading-relaxed text-zinc-500">No account is required. Use an email you can access now, even if it differs from your lost account email. We will contact you there. Keep your request reference.</p></div><Link href="/privacy" className="mt-6 inline-block text-sm text-zinc-500 underline">Privacy policy</Link></div><section aria-label="Support message form" className="min-w-0 border-t border-zinc-200 bg-white py-6 sm:py-8"><ContactSupportForm recovery={recovery} /></section></main>;
}

export default withExperiencePage(ContactSupportPage);
