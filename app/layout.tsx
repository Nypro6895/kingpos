import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SalonSwitcher } from "@/app/salon-switcher";
import { getCurrentBusinessContext } from "@/lib/current-context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KingPOS",
  description: "KingPOS salon workspace",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const context = await getCurrentBusinessContext();

  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-zinc-50 antialiased`}
      lang="en"
    >
      <body className="min-h-full bg-zinc-50 text-zinc-950">
        <SalonSwitcher context={context}>{children}</SalonSwitcher>
      </body>
    </html>
  );
}
