"use server";
import { withSettingsTarget } from "@/lib/settings-target-context";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { savePosSettingsGroup } from "@/app/pos/settings/actions";
import {
  PORTABLE_POS_CAPABILITIES,
  type PortablePosCapability,
} from "@/lib/pos-portable-capabilities";
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
async function access(salonId: string, permission = "tickets.manage") {
  const context = await getCurrentBusinessContext();
  if (
    !context.user ||
    !isSalonManageContext(context) ||
    context.salonId !== salonId
  )
    throw new Error(
      "The selected salon changed. Reload settings before saving.",
    );
  await requirePermission(permission, context);
  const supabase = await createAuthenticatedSupabaseServerClient();
  if (!supabase) throw new Error("Your session is unavailable.");
  return { context, supabase };
}
export async function saveDirectPosGroup(salonId: string, form: FormData) {
 return withSettingsTarget(salonId, async () => {
  try {
    await access(salonId);
    return await savePosSettingsGroup(form);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save POS settings.",
    };
  }

 }, "manage");
}
export async function saveDirectPortableAccess(
  salonId: string,
  form: FormData,
) {
 return withSettingsTarget(salonId, async () => {
  try {
    const { context, supabase } = await access(salonId, "salon_settings.manage"),
      action = String(form.get("action"));
    const allowed = new Set<string>(Object.values(PORTABLE_POS_CAPABILITIES));
    const selected = form
      .getAll("capabilities")
      .filter(
        (v): v is PortablePosCapability =>
          typeof v === "string" && allowed.has(v),
      );
    const capabilities = new Set<PortablePosCapability>([
      PORTABLE_POS_CAPABILITIES.posUse,
      ...selected,
    ]);
    if (
      capabilities.has(PORTABLE_POS_CAPABILITIES.bookCreate) ||
      capabilities.has(PORTABLE_POS_CAPABILITIES.bookCancel)
    )
      capabilities.add(PORTABLE_POS_CAPABILITIES.bookView);
    if (action === "create") {
      const accessId = String(form.get("access_id") ?? "")
          .trim()
          .replace(/\s+/g, "-"),
        passcode = String(form.get("passcode") ?? "").trim();
      if (!/^[a-zA-Z0-9._-]{3,48}$/.test(accessId))
        throw new Error(
          "POS ID must use 3–48 letters, numbers, dots, dashes or underscores.",
        );
      if (passcode.length < 4 || passcode.length > 32)
        throw new Error("Passcode must have 4–32 characters.");
      const salt = randomBytes(16).toString("hex"),
        digest = createHash("sha256")
          .update(`${accessId.toLowerCase()}:${passcode}:${salt}`)
          .digest("hex");
      const { error } = await supabase
        .from("pos_portable_access_keys")
        .insert({
          salon_id: salonId,
          access_id: accessId,
          label: String(form.get("label") ?? "").trim() || null,
          capabilities: [...capabilities],
          created_by: context.user!.id,
          is_active: true,
          passcode_digest: digest,
          passcode_salt: salt,
        });
      if (error)
        throw new Error(
          error.code === "23505"
            ? "That POS ID is already in use."
            : error.message,
        );
    } else {
      const keyId = String(form.get("key_id") ?? "");
      if (!keyId) throw new Error("Choose a POS access key.");
      if (!["capabilities", "status", "passcode", "label", "delete"].includes(action)) throw new Error("Unknown POS access action.");
      const current=await supabase.from("pos_portable_access_keys").select("id,access_id,last_used_at,last_login_at").eq("id",keyId).eq("salon_id",salonId).maybeSingle();
      if(current.error||!current.data)throw new Error(current.error?.message??"This POS access key is unavailable.");
      let patch: {is_active?:boolean;capabilities?:PortablePosCapability[];label?:string|null;passcode_salt?:string;passcode_digest?:string}={};
      if(action==='status')patch={is_active:form.get('active')==='true'};
      if(action==='capabilities')patch={capabilities:[...capabilities]};
      if(action==='label')patch={label:String(form.get('label')||'').trim()||null};
      if(action==='passcode'){
        const passcode=String(form.get('passcode')||'').trim();
        if(passcode.length<4||passcode.length>32)throw new Error('Passcode must have 4–32 characters.');
        const salt=randomBytes(16).toString('hex');patch={passcode_salt:salt,passcode_digest:createHash('sha256').update(`${current.data.access_id.toLowerCase()}:${passcode}:${salt}`).digest('hex')};
      }
      if(action==='delete'&&(current.data.last_used_at||current.data.last_login_at||form.get('confirmed')!=='on'))throw new Error('Only unused access keys can be deleted. Disable used access keys to preserve their history.');
      const mutation=action==='delete'?supabase.from('pos_portable_access_keys').delete().is('last_used_at',null).is('last_login_at',null):supabase.from('pos_portable_access_keys').update(patch);
      const {data,error}=await mutation.eq('id',keyId).eq('salon_id',salonId).select('id').maybeSingle();
      if (error || !data)
        throw new Error(
          error?.message ?? "This POS access key is unavailable.",
        );
    }
    revalidatePath("/pos/settings");
    revalidatePath("/pos/portable");
    revalidatePath("/settings");
    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Could not update POS access.",
    };
  }

 }, "manage");
}
export async function resetDirectStaffPasscode(
  salonId: string,
  staffId: string,
  form: FormData,
) {
 return withSettingsTarget(salonId, async () => {
  try {
    const { supabase } = await access(salonId, "staff.manage");
    const passcode = String(form.get("passcode") ?? "");
    if (!/^\d{4,8}$/.test(passcode))
      throw new Error("Use a passcode with 4–8 digits.");
    const salt = randomBytes(16).toString("hex"),
      digest = createHash("sha256")
        .update(`${salonId}:${staffId}:${passcode}:${salt}`)
        .digest("hex");
    const { data, error } = await supabase
      .from("staff")
      .update({
        passcode_salt: salt,
        passcode_digest: digest,
        passcode_is_default: passcode === "1234",
      })
      .eq("id", staffId)
      .eq("salon_id", salonId)
      .select("id")
      .maybeSingle();
    if (error || !data)
      throw new Error(error?.message ?? "Staff profile is unavailable.");
    revalidatePath("/staff");
    revalidatePath("/pos");
    revalidatePath("/pos/portable");
    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Could not reset passcode.",
    };
  }

 }, "manage");
}
