"use server";
import type { ScanDeskLine } from "@/types/staff-scan";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { marketPluginContext } from "@/lib/market-plugins";
import { broadcastPosStaffChange } from "@/lib/pos-staff-realtime-server";
import { revalidatePath } from "next/cache";
import { SERVICE_RELAY_PLUGIN, type RelayWorkspace } from "@/types/service-relay";

function message(error: unknown) { return error instanceof Error ? error.message : "Please reconnect and try again."; }
function revalidateServiceRelay() {
  // Retained pages may have disconnected their realtime listeners.
  for (const path of ["/staff/today", "/staff/my-work", "/notifications"]) revalidatePath(path);
}
async function staffContext() {
  const { context, staff, supabase } = await getStaffPortalIdentity();
  if (!context.currentSalon || !staff || !supabase) throw new Error("Open your Staff workspace first.");
  return { client: supabase, salonId: context.currentSalon.id };
}
async function deskContext() {
  const context = await getCurrentBusinessContext();
  const client = await createAuthenticatedSupabaseServerClient();
  if (!context.user || !context.currentSalon || !client) throw new Error("Open your salon POS first.");
  return { client, salonId: context.currentSalon.id };
}
export async function serviceRelayInstalled(salonId: string) {
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) return false;
  const { data, error } = await client.from("salon_market_plugins").select("plugin_id").eq("salon_id", salonId).eq("plugin_id", SERVICE_RELAY_PLUGIN).maybeSingle();
  if (error) throw new Error("Could not load Phone Checkin.");
  return Boolean(data);
}
export async function setServiceRelayPlugin(installed: boolean) {
  try {
    const { client, salonId } = await marketPluginContext();
    const { error } = installed
      ? await client.from("salon_market_plugins").upsert({ salon_id: salonId, plugin_id: SERVICE_RELAY_PLUGIN }, { onConflict: "salon_id,plugin_id", ignoreDuplicates: true })
      : await client.from("salon_market_plugins").delete().eq("salon_id", salonId).eq("plugin_id", SERVICE_RELAY_PLUGIN);
    if (error) throw new Error(error.message);
    revalidatePath("/market");
    await broadcastPosStaffChange(salonId, "pos");
    return { installed };
  } catch (error) { return { error: message(error) }; }
}
export async function loadServiceRelay(desk = false): Promise<{ data?: RelayWorkspace; error?: string }> {
  try {
    const { client, salonId } = desk ? await deskContext() : await staffContext();
    const { data, error } = await client.rpc("service_relay_workspace", { p_salon: salonId, p_desk: desk });
    if (error) throw new Error(error.message);
    return { data: data as RelayWorkspace };
  } catch (error) { return { error: message(error) }; }
}
export async function respondServiceRelay(offerId: string, accept: boolean) {
  try {
    const { client, salonId } = await staffContext();
    const { error } = await client.rpc("service_relay_respond", { p_salon: salonId, p_offer: offerId, p_accept: accept });
    if (error) throw new Error(error.message);
    revalidateServiceRelay();
    await broadcastPosStaffChange(salonId, "pos");
    return { ok: true };
  } catch (error) { return { error: message(error) }; }
}
export async function saveServiceRelay(input: { offerId: string; lines: { id: string; serviceId: string; amount: string }[]; done: boolean; revision: number }) {
  try {
    const { client, salonId } = await staffContext();
    const { error } = await client.rpc("service_relay_save", { p_salon: salonId, p_offer: input.offerId, p_lines: input.lines, p_done: input.done, p_expected: input.revision });
    if (error) throw new Error(error.message);
    revalidateServiceRelay();
    await broadcastPosStaffChange(salonId, "pos");
    return { ok: true };
  } catch (error) { return { error: message(error) }; }
}
export async function submitServiceRelay(input: { visitId: string; revision: number; tip: number; discount: number }) {
  try {
    const { client, salonId } = await deskContext();
    const { data, error } = await client.rpc("service_relay_submit", { p_salon: salonId, p_visit: input.visitId, p_expected: input.revision, p_tip: input.tip, p_discount: input.discount });
    if (error) throw new Error(error.message);
    revalidateServiceRelay();
    await broadcastPosStaffChange(salonId, "pos");
    return { ok: true, ticketId: String(data.ticketId) };
  } catch (error) { return { error: message(error) }; }
}
export async function issueServiceRelayPass(token: string, visitId: string) {
  try {
    const client = createSupabaseServerClient();
    if (!client) throw new Error("Check-in is unavailable.");
    const { data, error } = await client.rpc("service_relay_issue_pass", { p_token: token, p_visit: visitId });
    if (error) throw new Error(error.message);
    return { data: data as { passToken: string; queueNumber: number } | null };
  } catch (error) { return { error: message(error) }; }
}
export async function findServiceRelay(code: string) {
  try {
    const { client, salonId } = await staffContext();
    const { error } = await client.rpc("service_relay_claim", { p_salon: salonId, p_code: code.trim() });
    if (error) throw new Error(error.message);
    revalidateServiceRelay();
    await broadcastPosStaffChange(salonId, "pos");
    return { ok: true };
  } catch (error) { return { error: message(error) }; }
}

export async function saveServiceRelayAtDesk(input: { visitId: string; revision: number; lines: ScanDeskLine[] }) {
  try {
    const { client, salonId } = await deskContext();
    const { error } = await client.rpc("staff_scan_desk_save", { p_salon: salonId, p_visit: input.visitId, p_expected: input.revision, p_lines: input.lines });
    if (error) throw new Error(error.message);
    revalidateServiceRelay();
    await broadcastPosStaffChange(salonId, "pos");
    return { ok: true };
  } catch (error) { return { error: message(error) }; }
}

export async function notifyPersonalReady(input: { visitId: string; staffId: string | null; chair: string; requestId: string }) {
  try {
    const { client, salonId } = await deskContext();
    const { error } = await client.rpc("personal_qr_notify_ready", { p_salon: salonId, p_visit: input.visitId, p_staff: input.staffId, p_chair: input.chair, p_request: input.requestId });
    if (error) throw new Error(error.message);
    revalidatePath("/qr"); revalidatePath("/notifications");
    await broadcastPosStaffChange(salonId, "waiting");
    return { ok: true };
  } catch (error) { return { error: message(error) }; }
}
