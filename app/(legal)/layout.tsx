import { GuestNavigationShell } from "@/app/guest-navigation-shell";
import { REYLUMI_METADATA_BASE } from "@/lib/reylumi-config";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Manrope } from "next/font/google";
import { Suspense } from "react";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-booking-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: REYLUMI_METADATA_BASE,
  title: "Reylumi",
  description: "Reylumi beauty booking and salon workspace",
  icons: {
    apple: [
      {
        sizes: "364x364",
        type: "image/png",
        url: "/apple-icon.png",
      },
    ],
    icon: [
      {
        sizes: "364x364",
        type: "image/png",
        url: "/brand/reylumi-favicon.png",
      },
    ],
    shortcut: [
      {
        sizes: "364x364",
        type: "image/png",
        url: "/brand/reylumi-favicon.png",
      },
    ],
  },
};

export default function LegalRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} h-full bg-white antialiased`}
      lang="en"
    >
      <body className="min-h-full bg-white text-zinc-950">
        <Suspense fallback={children}>
          <GuestNavigationShell>{children}</GuestNavigationShell>
        </Suspense>
      </body>
    </html>
  );
}
