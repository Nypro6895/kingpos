import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { staffHasPersonalAccount, type StaffLegalIdentity } from "./staff-legal-name";

type StaffLegalNameRow = { staff_id: string; first_name: string | null; last_name: string | null };
/** Read linked Personal names through the salon-scoped RPC, without broad users access. */
export async function resolveStaffLegalNames<T extends StaffLegalIdentity & { id: string; salon_id: string }>(staff: T[], supabase: SupabaseClient): Promise<T[]> {
  const bySalon = new Map<string, T[]>();
  for (const row of staff) {
    if (!staffHasPersonalAccount(row)) continue;
    bySalon.set(row.salon_id, [...(bySalon.get(row.salon_id) ?? []), row]);
  }
  const names = new Map<string, StaffLegalNameRow>();
  for (const [salonId, rows] of bySalon) {
    for (let offset = 0; offset < rows.length; offset += 500) {
      const ids = rows.slice(offset, offset + 500).map(row => row.id);
      const { data, error } = await supabase.rpc("get_staff_legal_names", { p_salon: salonId, p_staff: ids });
      if (error) throw new Error("Legal name could not be loaded from Personal. Please try again.");
      const requested = new Set(ids);
      for (const name of (data ?? []) as StaffLegalNameRow[]) {
        if (requested.has(name.staff_id)) names.set(name.staff_id, name);
      }
    }
  }
  return staff.map(row => {
    if (!staffHasPersonalAccount(row)) return row;
    const name = names.get(row.id);
    if (!name) throw new Error("Legal name could not be loaded from Personal. Please try again.");
    return { ...row, first_name: name.first_name, last_name: name.last_name };
  });
}
