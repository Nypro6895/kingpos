import type { Metadata } from "next";
import "@/app/globals.css";
export const metadata: Metadata = { title: "Salon check-in | Reylumi", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function CheckinLayout({ children }: { children: React.ReactNode }) { return <div className="min-h-dvh bg-zinc-50 text-zinc-950">{children}</div>; }
