import { GuestNavigationShell } from "@/app/guest-navigation-shell";
import { LegalNavigationShell } from "@/app/legal/legal-navigation-shell";
import { Suspense } from "react";
export { metadata } from "../layout";

export default function LegalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <Suspense fallback={<GuestNavigationShell authenticated={null}>{children}</GuestNavigationShell>}><LegalNavigationShell>{children}</LegalNavigationShell></Suspense>;
}
