import "server-only";

import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

export type AppNotification = {
  body: string | null;
  booking_id: string | null;
  created_at: string;
  href: string;
  id: string;
  notification_type: string;
  read_at: string | null;
  recipient_kind: "customer" | "owner_manager" | "staff";
  salon_id: string | null;
  title: string;
};

export async function getCurrentAppNotifications(limit = 40) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("app_notifications")
    .select(
      "id, salon_id, recipient_kind, notification_type, booking_id, title, body, href, read_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<AppNotification[]>();

  if (error) {
    console.error("Supabase load app notifications failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return [];
  }

  return data ?? [];
}

export async function countUnreadAppNotifications() {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return 0;
  }

  const { count, error } = await supabase
    .from("app_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  if (error) {
    return 0;
  }

  return count ?? 0;
}

export async function markAppNotificationRead(notificationId: string) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return;
  }

  await supabase
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .is("read_at", null);
}
