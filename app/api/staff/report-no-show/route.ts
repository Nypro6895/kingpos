import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ok: false, message: "Invalid request origin."}, {status: 403});
  try {
    const input = await request.json();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.bookingId ?? "") || !["unexcused", "excused"].includes(input.kind) || typeof input.reason !== "string" || input.reason.length > 1000 || (input.kind === "excused" && !input.reason.trim())) return Response.json({ok: false, message: "Choose a no-show type and add a reason when required."}, {status: 400});
    const supabase = await createAuthenticatedSupabaseServerClient();
    if (!supabase) return Response.json({ok: false, message: "Sign in required."}, {status: 401});
    const {data, error} = await supabase.rpc("report_assigned_booking_no_show", {p_booking_id: input.bookingId, p_kind: input.kind, p_reason: input.reason.trim() || null});
    if (error) return Response.json({ok: false, message: error.message}, {status: error.code === "42501" ? 403 : 409});
    revalidatePath("/staff/appointments");
    revalidatePath("/bookings");
    revalidatePath("/my-bookings");
    revalidatePath(`/my-bookings/${input.bookingId}`);
    return Response.json(data, {headers: {"Cache-Control": "no-store"}});
  } catch { return Response.json({ok: false, message: "Unable to report no-show. Please try again."}, {status: 500}); }
}
