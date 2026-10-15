import type { Metadata } from "next";
import { TaxAppRuntime } from "@/app/tax-company/install-control";
export const metadata: Metadata = { title: "Tax Company | Reylumi", manifest: "/tax-company/manifest.webmanifest", appleWebApp: { capable: true, title: "Tax Company", statusBarStyle: "default" }, icons: { apple: "/tax-company/icon-192.png" } };
export default function TaxLayout({ children }: { children: React.ReactNode }) { return <><TaxAppRuntime />{children}</>; }
