import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403 });
  }
  const started = performance.now();
  try {
    const input = await request.json();
    if (!/^[0-9a-f-]{36}$/i.test(input.salonId ?? "") || (input.preference !== undefined && (!["online", "notifications"].includes(input.preference) || typeof input.enabled !== "boolean"))) {
      return Response.json({ ok: false, error: "Invalid preference." }, { status: 400 });
    }
    const supabase = await createAuthenticatedSupabaseServerClient();
    const authenticated = performance.now();
    if (!supabase) return Response.json({ ok: false, error: "Please sign in again." }, { status: 401 });
    // The RPC derives the staff ID from the authenticated user, never from input.
    const { data, error } = await supabase.rpc("own_staff_booking_preferences", {
      p_salon_id: input.salonId,
      p_online: input.preference === "online" ? input.enabled : null,
      p_notifications: input.preference === "notifications" ? input.enabled : null,
    });
    const saved = performance.now();
    if (error || !data?.ok) return Response.json({ ok: false, error: error?.message ?? "Unable to save your preferences." }, { status: 400 });
    if (input.preference) {
      revalidatePath("/staff/appointments");
      if (input.preference === "online") revalidatePath(`/book/${input.salonId}`);
    }
    return Response.json({ ok: true, online: Boolean(data.online), notifications: Boolean(data.notifications) }, {
      headers: { "Cache-Control": "no-store", "Server-Timing": `auth;dur=${(authenticated - started).toFixed(1)},rpc;dur=${(saved - authenticated).toFixed(1)}` },
    });
  } catch {
    return Response.json({ ok: false, error: "Unable to save preferences. Please try again." }, { status: 500 });
  }
}
