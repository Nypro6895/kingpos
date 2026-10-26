"use server";

import { revalidatePath } from "next/cache";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { getCurrentBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { broadcastPosStaffChange } from "@/lib/pos-staff-realtime-server";
import { personalQrToken } from "@/lib/personal-qr";
import type { PersonalQrCatalog, PersonalQrWorkspace, PersonalStaffPreview } from "@/types/personal-qr";

async function personal(viewerId: string) {
  const [user, client] = await Promise.all([getCurrentKingUser(), createAuthenticatedSupabaseServerClient()]);
  if (!user || !client || user.id !== viewerId) throw new Error("Your account changed. Reopen My QR.");
  return client;
}
async function owner(scope: { salonId: string; viewerId: string }) {
  const context = await getCurrentBusinessContext();
  if (!isSalonManageContext(context) || context.currentSalon?.id !== scope.salonId || context.user?.id !== scope.viewerId) throw new Error("Your workspace changed. Reopen Add staff.");
  return personal(scope.viewerId);
}
const message = (error: unknown) => error instanceof Error ? error.message : "Reconnect and try again.";

export async function loadPersonalQr(viewerId: string): Promise<{ data?: PersonalQrWorkspace; error?: string }> {
  try {
    const client = await personal(viewerId);
    const { data, error } = await client.rpc("personal_qr_workspace").abortSignal(AbortSignal.timeout(10000));
    if (error) throw new Error(error.message);
    return { data: data as PersonalQrWorkspace };
  } catch (error) { return { error: message(error) }; }
}
export async function loadPersonalQrCatalog(viewerId: string, entry: string): Promise<{ catalog?: PersonalQrCatalog; error?: string }> {
  try {
    const client = await personal(viewerId);
    const { data, error } = await client.rpc("service_relay_entry_catalog", { p_entry: entry }).abortSignal(AbortSignal.timeout(8000));
    if (error || !data) throw new Error("Check-in QR expired. Scan the salon screen again.");
    return { catalog: data as PersonalQrCatalog };
  } catch (error) { return { error: message(error) }; }
}
export async function checkinPersonalQr(viewerId: string, input: { entry: string; services: string[]; requestId: string }) {
  try {
    const client = await personal(viewerId);
    const { data, error } = await client.rpc("personal_qr_checkin", { p_entry: input.entry, p_services: input.services, p_request: input.requestId }).abortSignal(AbortSignal.timeout(12000));
    if (error || !data) throw new Error(error?.message ?? "Could not save check-in.");
    const visitId = String(data);
    const visit = await client.rpc("personal_qr_visit", { p_visit: visitId });
    if (visit.data?.salonId) await broadcastPosStaffChange(visit.data.salonId, "waiting");
    for (const path of ["/qr", "/activity", "/staff/scan"]) revalidatePath(path);
    return { visitId };
  } catch (error) { return { error: message(error) }; }
}
export async function previewPersonalStaffQr(scope: { salonId: string; viewerId: string }, code: string): Promise<{ preview?: PersonalStaffPreview; error?: string }> {
  try {
    const token = personalQrToken(code);
    if (!token) throw new Error("Scan their Personal ID QR from My QR.");
    const client = await owner(scope);
    const { data, error } = await client.rpc("personal_qr_staff_preview", { p_salon: scope.salonId, p_token: token }).abortSignal(AbortSignal.timeout(8000));
    if (error) throw new Error(error.message);
    return { preview: data as PersonalStaffPreview };
  } catch (error) { return { error: message(error) }; }
}
export async function sendPersonalStaffQr(scope: { salonId: string; viewerId: string }, code: string) {
  try {
    const token = personalQrToken(code);
    if (!token) throw new Error("Scan their Personal ID QR from My QR.");
    const client = await owner(scope);
    const { data, error } = await client.rpc("personal_qr_staff_send", { p_salon: scope.salonId, p_token: token }).abortSignal(AbortSignal.timeout(12000));
    if (error) throw new Error(error.message);
    for (const path of ["/staff", "/staff/connections", "/notifications", "/my-place"]) revalidatePath(path);
    await broadcastPosStaffChange(scope.salonId, "staff");
    return { status: String(data.status) };
  } catch (error) { return { error: message(error) }; }
}
