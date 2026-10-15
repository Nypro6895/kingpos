import { withExperiencePage } from "@/components/experience-page";
import Link from "next/link";
import type { Metadata } from "next";
import { ContactSupportForm } from "./contact-form";

export const metadata: Metadata = { title: "Contact Support · Reylumi", description: "Send a message to the Reylumi support team." };

function ContactSupportPage() {
  return <main className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-12 lg:grid-cols-[1fr_1.3fr] lg:py-20"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-orange-700">We are here to help</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Contact Support</h1><p className="mt-5 text-base leading-relaxed text-zinc-600">Have a question about your account, bookings or salon workspace? Tell us what happened and our support team will get back to you.</p><div className="mt-7 rounded-xl border border-zinc-200 bg-zinc-50 p-5"><p className="text-sm font-medium">Reylumi support</p><p className="mt-3 text-sm leading-relaxed text-zinc-500">No account is required. After sending, you can continue the conversation in this browser.</p></div><Link href="/privacy" className="mt-6 inline-block text-sm text-zinc-500 underline">Privacy policy</Link></div><section aria-label="Support message form" className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"><ContactSupportForm /></section></main>;
}

export default withExperiencePage(ContactSupportPage);
