import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request: Request) {
  const url = new URL(request.url), salon = url.searchParams.get("salonId");
  if (!uuid.test(salon ?? "")) return Response.json({message: "Invalid salon."}, {status: 400});
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) return Response.json({message: "Sign in required."}, {status: 401});
  const {data, error} = await client.rpc(url.searchParams.get("catalog") === "1" ? "staff_booking_creation_catalog" : "salon_staff_booking_creation", {p_salon: salon});
  return Response.json(error ? {message: error.message} : data, {status: error ? 403 : 200, headers: {"Cache-Control": "no-store"}});
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({message: "Invalid request origin."}, {status: 403});
  try {
    const input = await request.json();
    if (!uuid.test(input.salonId ?? "")) return Response.json({message: "Invalid salon."}, {status: 400});
    const client = await createAuthenticatedSupabaseServerClient();
    if (!client) return Response.json({message: "Sign in required."}, {status: 401});
    let result;
    if (input.action === "customers") {
      if (typeof input.query !== "string" || input.query.trim().length < 2 || input.query.length > 150) return Response.json([], {headers: {"Cache-Control": "no-store"}});
      const {data, error} = await client.rpc("staff_booking_customer_suggestions", {p_salon: input.salonId, p_query: input.query});
      return Response.json(error ? {message: error.message} : data, {status: error ? 403 : 200, headers: {"Cache-Control": "no-store"}});
    } else if (input.action === "permission") {
      if (typeof input.enabled !== "boolean") return Response.json({message: "Invalid permission."}, {status: 400});
      result = await client.rpc("salon_staff_booking_creation", {p_salon: input.salonId, p_enabled: input.enabled});
    } else if (input.action === "create") {
      result = await client.rpc("create_staff_appointment", {p_salon: input.salonId, p_input: input.appointment});
    } else return Response.json({message: "Invalid action."}, {status: 400});
    if (result.error) return Response.json({message: result.error.message}, {status: result.error.code === "42501" ? 403 : 409});
    revalidatePath("/staff/appointments"); revalidatePath("/bookings"); revalidatePath("/salon-settings");
    return Response.json(result.data, {headers: {"Cache-Control": "no-store"}});
  } catch { return Response.json({message: "Unable to save. Please try again."}, {status: 500}); }
}
