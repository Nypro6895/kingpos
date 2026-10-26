import type { Metadata } from "next";
import { geistSans, geistMono, manrope } from "@/app/fonts";
import { Suspense } from "react";
import { REYLUMI_METADATA_BASE } from "@/lib/reylumi-config";
import { AppStartupShell } from "@/components/app-startup-shell";
import ExperienceMediaCache from "@/components/experience-media-cache";
import { ExperienceOfflineBootstrap } from "@/components/experience-offline-bootstrap";
import "./globals.css";
import "@/components/settings-style.css";


export const metadata: Metadata = {
  metadataBase: REYLUMI_METADATA_BASE,
  title: "Reylumi",
  description: "Reylumi beauty booking and salon workspace",
  appleWebApp: {
    capable: true,
    title: "Reylumi",
    statusBarStyle: "default",
  },
  icons: {
    apple: [{ sizes: "364x364", type: "image/png", url: "/apple-icon.png" }],
    icon: [{ sizes: "364x364", type: "image/png", url: "/brand/reylumi-favicon.png" }],
    shortcut: [{ sizes: "364x364", type: "image/png", url: "/brand/reylumi-favicon.png" }],
  },
};

/** A single document root keeps fonts, assets and router state across all shells. */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} h-full bg-white antialiased`}>
    <head><ExperienceOfflineBootstrap /></head>
    <body className="min-h-full bg-white text-zinc-950">
      <Suspense fallback={null}><ExperienceMediaCache supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} /></Suspense>
      <Suspense fallback={<AppStartupShell />}>{children}</Suspense>
    </body>
  </html>;
}
