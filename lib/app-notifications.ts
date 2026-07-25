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

export type AppNotificationRecipientKind = AppNotification["recipient_kind"];

export type AppNotificationQueryScope = {
  accountId?: string | null;
  recipientKind?: AppNotificationRecipientKind | AppNotificationRecipientKind[];
  salonId?: string | null;
};

type GetCurrentAppNotificationsInput =
  | number
  | (AppNotificationQueryScope & {
      limit?: number;
      unreadOnly?: boolean;
    });

function normalizeNotificationInput(input: GetCurrentAppNotificationsInput = {}) {
  return typeof input === "number" ? { limit: input } : input;
}

function recipientKinds(
  recipientKind:
    | AppNotificationRecipientKind
    | AppNotificationRecipientKind[]
    | undefined,
) {
  return Array.isArray(recipientKind)
    ? recipientKind
    : recipientKind
      ? [recipientKind]
      : [];
}

export async function getCurrentAppNotifications(
  input: GetCurrentAppNotificationsInput = {},
) {
  const options = normalizeNotificationInput(input);
  const limit = options.limit ?? 40;
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  let query = supabase
    .from("app_notifications")
    .select(
      "id, salon_id, recipient_kind, notification_type, booking_id, title, body, href, read_at, created_at",
    );
  const kinds = recipientKinds(options.recipientKind);

  if (kinds.length === 1) {
    query = query.eq("recipient_kind", kinds[0]);
  } else if (kinds.length > 1) {
    query = query.in("recipient_kind", kinds);
  }

  if (options.accountId) {
    query = query.eq("account_id", options.accountId);
  }

  if (options.salonId) {
    query = query.eq("salon_id", options.salonId);
  }

  if (options.unreadOnly) {
    query = query.is("read_at", null);
  }

  const { data, error } = await query
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

export async function countUnreadAppNotifications(
  scope: AppNotificationQueryScope = {},
) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return 0;
  }

  let query = supabase
    .from("app_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  const kinds = recipientKinds(scope.recipientKind);

  if (kinds.length === 1) {
    query = query.eq("recipient_kind", kinds[0]);
  } else if (kinds.length > 1) {
    query = query.in("recipient_kind", kinds);
  }

  if (scope.accountId) {
    query = query.eq("account_id", scope.accountId);
  }

  if (scope.salonId) {
    query = query.eq("salon_id", scope.salonId);
  }

  const { count, error } = await query;

  if (error) {
    return 0;
  }

  return count ?? 0;
}

export async function markAppNotificationRead(notificationId: string) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return false;
  }

  const { error } = await supabase
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .is("read_at", null);

  if (error) {
    console.error("Supabase mark app notification read failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      notificationId,
    });
    return false;
  }

  return true;
}

export async function markAppNotificationsRead(
  scope: AppNotificationQueryScope = {},
) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return false;
  }

  let query = supabase
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  const kinds = recipientKinds(scope.recipientKind);

  if (kinds.length === 1) {
    query = query.eq("recipient_kind", kinds[0]);
  } else if (kinds.length > 1) {
    query = query.in("recipient_kind", kinds);
  }

  if (scope.accountId) {
    query = query.eq("account_id", scope.accountId);
  }

  if (scope.salonId) {
    query = query.eq("salon_id", scope.salonId);
  }

  const { error } = await query;

  if (error) {
    console.error("Supabase mark app notifications read failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return false;
  }

  return true;
}
