"use server";

import { getCurrentPortablePosSession } from "./actions";
import { PORTABLE_POS_CAPABILITIES as capabilities } from "@/lib/pos-portable-capabilities";
import PosPage from "@/app/(app)/pos/portable/page";
import CheckInPage from "@/app/(app)/pos/portable/check-in/page";
import BookPage from "@/app/(app)/pos/portable/book/page";
import ReportPage from "@/app/(app)/pos/portable/report/page";
import TicketPage from "@/app/(app)/pos/portable/ticket/page";

// Each lazy read rechecks the device session and capability. Never trust a panel
// name or a permission supplied by the browser.
export async function loadPortablePanel(path: string) {
  const session = await getCurrentPortablePosSession();
  const routes = {
    "/pos/portable": { capability: capabilities.posUse, render: () => PosPage() },
    "/pos/portable/check-in": { capability: capabilities.checkInUse, render: () => CheckInPage() },
    "/pos/portable/book": { capability: capabilities.bookView, render: () => BookPage({searchParams:Promise.resolve({})}) },
    "/pos/portable/report": { capability: capabilities.reportView, render: () => ReportPage({searchParams:Promise.resolve({})}) },
    "/pos/portable/ticket": { capability: capabilities.todayView, render: () => TicketPage({searchParams:Promise.resolve({})}) },
  };
  const entry = routes[path as keyof typeof routes];
  if (!session || !entry || !session.capabilities.includes(entry.capability)) {
    throw new Error("This view is not available for the current device session.");
  }
  return entry.render();
}
