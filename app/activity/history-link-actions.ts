"use server";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { HistoryEvidence } from "@/lib/booking-history";

export async function loadHistoryEvidenceAction(bookingId: string): Promise<{ evidence?: HistoryEvidence; error?: string }> {
  const supabase = await createAuthenticatedSupabaseServerClient();
  if (!supabase) return { error: "Sign in required." };
  const { data, error } = await supabase.rpc("get_booking_history_evidence", { p_bookings: [bookingId] });
  if (error) return { error: "History could not be loaded." };
  return { evidence: (data as unknown as HistoryEvidence[])?.[0] };
}

export async function setHistoryLinkAction(input: { bookingId: string; targetId: string; kind: "ticket" | "visit"; unlink?: boolean }) {
  const supabase = await createAuthenticatedSupabaseServerClient();
  if (!supabase) return { error: "Sign in required." };
  const { error } = await supabase.rpc("set_booking_history_link", {
    p_booking: input.bookingId, p_target: input.targetId, p_kind: input.kind, p_unlink: input.unlink ?? false,
  });
  if (error) return { error: error.message };
  for (const path of ["/activity", "/my-bookings", `/my-bookings/${input.bookingId}`, "/bookings"]) revalidatePath(path);
  return { error: null };
}
