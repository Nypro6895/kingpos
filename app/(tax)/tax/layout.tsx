import type { Metadata } from "next";
import { TaxAppRuntime } from "@/app/tax-company/install-control";
import "@/app/tax/tax-workspace.css";
export const metadata: Metadata = {
  title: "Tax | ReyLUMI",
  manifest: "/tax/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "ReyLUMI Tax" },
};
export default function TaxLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TaxAppRuntime />
      {children}
    </>
  );
}
