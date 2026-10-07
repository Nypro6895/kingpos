import "server-only";
import { createClient } from "@supabase/supabase-js";
export async function enqueueNotificationReminders() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured: false, queued: 0 };
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data, error }, following] = await Promise.all([
    client.rpc("enqueue_notification_reminders", { p_limit: 100 }),
    client.rpc("enqueue_following_notification_digest", { p_limit: 100 }),
  ]);
  if (error)
    return {
      configured: true,
      queued: 0,
      error: "Could not queue in-app appointment reminders.",
    };
  return {
    configured: true,
    queued: Number(data ?? 0),
    followingQueued: Number(following.data ?? 0),
    ...(following.error
      ? { followingError: "Could not queue followed-post digest." }
      : {}),
  };
}
