"use server";

import { revalidatePath } from "next/cache";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import { broadcastPosStaffChange } from "@/lib/pos-staff-realtime-server";
import { parseStaffScanCode } from "@/lib/staff-scan";
import { personalQrToken } from "@/lib/personal-qr";
import type { ScanEntryLine, StaffScanWorkspace } from "@/types/staff-scan";
import type { RelayTicket } from "@/types/service-relay";

type ScanScope = { salonId: string; staffId: string };
async function context(scope: ScanScope) {
  const identity = await getStaffPortalIdentity();
  if (!identity.staff || !identity.supabase || !identity.context.currentSalon) throw new Error("Open your Staff workspace first.");
  if (identity.staff.id !== scope.staffId || identity.context.currentSalon.id !== scope.salonId) throw new Error("Your workspace changed. Reopen Scan before continuing.");
  return { client: identity.supabase, salonId: identity.context.currentSalon.id };
}
function message(error: unknown) { return error instanceof Error ? error.message : "Reconnect and try again."; }
async function changed(salonId: string) {
  for (const path of ["/staff/scan", "/staff/my-work", "/staff/today"]) revalidatePath(path);
  await broadcastPosStaffChange(salonId, "pos");
}

export async function loadStaffScan(scope: ScanScope): Promise<{ data?: StaffScanWorkspace; error?: string }> {
  try {
    const { client, salonId } = await context(scope);
    const { data, error } = await client.rpc("staff_scan_workspace", { p_salon: salonId });
    if (error) throw new Error(error.message);
    return { data: data as StaffScanWorkspace };
  } catch (error) { return { error: message(error) }; }
}
export async function connectStaffScan(scope: ScanScope, input: { visitId: string } | { code: string }): Promise<{ ticket?: RelayTicket; error?: string }> {
  try {
    const { client, salonId } = await context(scope);
    // Resolve tokens inside the authorized RPC, without exposing relay tables.
    const identityToken = "code" in input ? personalQrToken(input.code) : null;
    if (identityToken) {
      const { data, error } = await client.rpc("personal_qr_connect_customer", { p_salon: salonId, p_token: identityToken });
      if (error) throw new Error(error.message);
      await changed(salonId);
      return { ticket: data as RelayTicket };
    }
    const parsed = "code" in input ? parseStaffScanCode(input.code) : input;
    if (!parsed) throw new Error("Scan a Reylumi customer check-in QR.");
    const { data, error } = "passToken" in parsed
      ? await client.rpc("staff_scan_connect_pass", { p_salon: salonId, p_pass: parsed.passToken })
      : await client.rpc("staff_scan_connect", { p_salon: salonId, p_visit: parsed.visitId });
    if (error) throw new Error(error.message);
    await changed(salonId);
    return { ticket: data as RelayTicket };
  } catch (error) { return { error: message(error) }; }
}
export async function saveStaffScan(scope: ScanScope, input: { offerId: string; revision: number; lines: ScanEntryLine[]; done: boolean }): Promise<{ ticket?: RelayTicket; error?: string }> {
  try {
    const { client, salonId } = await context(scope);
    const { data, error } = await client.rpc("staff_scan_save", { p_salon: salonId, p_offer: input.offerId, p_expected: input.revision, p_lines: input.lines, p_done: input.done });
    if (error) throw new Error(error.message);
    await changed(salonId);
    return { ticket: data as RelayTicket };
  } catch (error) { return { error: message(error) }; }
}
export async function cancelStaffScan(scope: ScanScope, input: { offerId: string; revision: number }) {
  try {
    const { client, salonId } = await context(scope);
    const { error } = await client.rpc("staff_scan_cancel", { p_salon: salonId, p_offer: input.offerId, p_expected: input.revision });
    if (error) throw new Error(error.message);
    await changed(salonId);
    return { ok: true };
  } catch (error) { return { error: message(error) }; }
}
