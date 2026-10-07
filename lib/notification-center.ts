import "server-only";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getAppNotificationScopeForContext } from "@/lib/workspace-pending";
import type { CurrentBusinessContext } from "@/lib/current-context";
import { appNotificationToFeedItem } from "@/lib/notification-feed-items";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { getBeautyMediaPublicUrl } from "@/lib/beauty-media";
import { getSupabaseConfig } from "@/lib/supabase/server";
import type { AppNotification } from "@/lib/app-notifications";
export type NotificationCursor = { at: string; id: string };
export async function loadNotificationPage(
  context: CurrentBusinessContext,
  input: { cursor?: NotificationCursor; unread?: boolean; limit?: number } = {},
) {
  const client = await createAuthenticatedSupabaseServerClient();
  if (!context.user || !client) throw new Error("Please sign in again.");
  const scope = getAppNotificationScopeForContext(context);
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const { data, error } = await client.rpc("notification_feed", {
    p_kind: scope.recipientKind as string,
    p_salon: scope.salonId ?? null,
    p_account: scope.accountId ?? null,
    p_unread: input.unread ?? false,
    p_before: input.cursor?.at ?? null,
    p_before_id: input.cursor?.id ?? null,
    p_limit: limit + 1,
  });
  if (error) throw new Error("Could not load notifications. Please try again.");
  const rows = (data?.items ?? []) as AppNotification[];
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: await Promise.all(
      visible.map(async (row) => {
        const href = row.href.split(/[?#]/)[0];
        const match =
          href.match(/\/(looks|updates|posts)\/([0-9a-f-]{36})$/i) ??
          (row.notification_type === "beauty_salon_publication_request" &&
          row.event_key?.match(
            /^beauty_salon_publication_request:([0-9a-f-]{36}):/i,
          )
            ? ["", "posts", row.event_key.split(":")[1]]
            : null);
        if (match) {
          // Read media through the authenticated client so content permissions still apply.
          if (match[1] === "posts") {
            const { data } = await client
              .from("beauty_post_media")
              .select("object_path")
              .eq("post_id", match[2])
              .order("display_order")
              .limit(1)
              .maybeSingle();
            const config = getSupabaseConfig();
            if (data && config)
              row.thumbnail_url = getBeautyMediaPublicUrl({
                path: data.object_path,
                supabaseUrl: config.supabaseUrl,
              });
          } else {
            const { data } = await client
              .from(
                match[1] === "looks"
                  ? "salon_profile_looks"
                  : "salon_profile_updates",
              )
              .select("media_path")
              .eq("id", match[2])
              .maybeSingle();
            if (data)
              row.thumbnail_url = getSalonProfileMediaUrl(data.media_path);
          }
        }
        return appNotificationToFeedItem(row);
      }),
    ),
    unreadCount: Number(data?.unreadCount ?? 0),
    cursor:
      rows.length > limit && last ? { at: last.created_at, id: last.id } : null,
  };
}
