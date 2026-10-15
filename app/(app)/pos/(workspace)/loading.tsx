"use client";

import { usePathname } from "next/navigation";
import { PosTabPlaceholder, type PosWorkspaceTab } from "@/app/pos/pos-tab-placeholder";

/** This boundary is below the persistent checkout layout, so only the new
 * panel streams while the existing checkout and navigation stay available. */
export default function OwnerWorkspaceLoading() {
  const pathname = usePathname();
  const tab: PosWorkspaceTab = pathname === "/pos/book" ? "book"
    : pathname === "/pos/check-in" ? "checkIn"
      : pathname === "/pos/report" ? "report"
        : pathname.startsWith("/pos/ticket") ? "ticket" : "pos";
  return <PosTabPlaceholder tab={tab} />;
}
