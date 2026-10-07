import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import {
  getCurrentBusinessContext,
  isSalonStaffContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { NOTIFICATION_CATEGORIES } from "@/lib/notification-categories";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client)
    return Response.json(
      { error: "Please sign in again." },
      { status: 401, headers },
    );
  const { data, error } = await client
    .from("notification_preferences")
    .select("category,enabled");
  if (error)
    return Response.json(
      { error: "Notification settings are temporarily unavailable." },
      { status: 503, headers },
    );
  const context = await getCurrentBusinessContext();
  let staffBooking: { salonId: string; enabled: boolean } | null = null;
  if (isSalonStaffContext(context) && context.currentSalon) {
    const result = await client.rpc("own_staff_booking_preferences", {
      p_salon_id: context.currentSalon.id,
    });
    if (!result.error && result.data?.ok)
      staffBooking = {
        salonId: context.currentSalon.id,
        enabled: Boolean(result.data.notifications),
      };
  }
  return Response.json(
    {
      preferences: Object.fromEntries(
        (data ?? []).map((row) => [row.category, row.enabled]),
      ),
      checkInDefault: isSalonStaffContext(context),
      staffBooking,
      bookingSettingsHref:
        isSalonManageContext(context) &&
        (await hasPermission("booking.view", context))
          ? "/bookings?tab=settings"
          : null,
    },
    { headers },
  );
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json(
      { error: "Invalid origin." },
      { status: 403, headers },
    );
  try {
    const input = await request.json();
    if (
      !NOTIFICATION_CATEGORIES.some((c) => c.id === input.category) ||
      typeof input.enabled !== "boolean"
    )
      return Response.json(
        { error: "Invalid preference." },
        { status: 400, headers },
      );
    const client = await createAuthenticatedSupabaseServerClient();
    if (!client)
      return Response.json(
        { error: "Please sign in again." },
        { status: 401, headers },
      );
    const { data: user, error: authError } = await client.rpc(
      "current_public_user_id",
    );
    if (authError || !user)
      return Response.json(
        { error: "Please sign in again." },
        { status: 401, headers },
      );
    const { error } = await client.from("notification_preferences").upsert({
      user_id: user,
      category: input.category,
      enabled: input.enabled,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json(
      { error: "Could not save notification settings." },
      { status: 503, headers },
    );
  }
}
