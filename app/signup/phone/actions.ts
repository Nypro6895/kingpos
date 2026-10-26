"use server";

import { claimCustomersForVerifiedPhone } from "@/lib/customer-identity-claims";
import { recordCustomerVerifiedPhoneFromAuth } from "@/lib/customer-phone-verification";
import { normalizePhoneForIdentity } from "@/lib/phone-normalization";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import { createAuthenticatedSupabaseAuthSessionServerClient, createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { revalidatePath } from "next/cache";

export type PhoneHistoryProfile = { id: string; name: string; salonName: string; linked: boolean };
export type SignupHistoryResult = { error?: string; profiles?: PhoneHistoryProfile[]; redirectTo?: string };

async function verifiedContext() {
  const [auth, db, user] = await Promise.all([
    createAuthenticatedSupabaseAuthSessionServerClient(),
    createAuthenticatedSupabaseServerClient(), getCurrentKingUser(),
  ]);
  if (!auth || !db || !user) return null;
  const { data, error } = await auth.auth.getUser();
  const phone = normalizePhoneForIdentity(data.user?.phone);
  if (error || !phone || !data.user?.phone_confirmed_at || data.user.id !== user.auth_user_id) return null;
  return { auth, db, user, phone };
}

export async function loadSignupHistoryAction(): Promise<SignupHistoryResult> {
  const context = await verifiedContext();
  if (!context) return { error: "Verify your phone to connect your salon history." };
  const { phone, db, user } = context;
  const verified = await recordCustomerVerifiedPhoneFromAuth(phone);
  if (!verified.ok) return { error: verified.message };
  const claimed = await claimCustomersForVerifiedPhone(phone);
  if (!claimed.ok) return { error: claimed.message };
  const saved = await db.from("users").update({ phone }).eq("id", user.id);
  if (saved.error) return { error: "Your phone could not be saved. Please retry." };
  const { data, error } = await db.rpc("get_my_phone_history_profiles", { p_phone: phone });
  if (error || !data?.ok) return { error: "Your history could not be loaded. Please retry." };
  revalidatePath("/activity");
  return { profiles: data.profiles as PhoneHistoryProfile[] };
}

export async function finishSignupPhoneAction(input: { customerIds: string[]; nextPath: string }): Promise<SignupHistoryResult> {
  const context = await verifiedContext();
  if (!context) return { error: "Verify your phone before completing signup." };
  if (!Array.isArray(input.customerIds) || input.customerIds.length > 200
    || input.customerIds.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) {
    return { error: "Choose your profiles again." };
  }
  if (input.customerIds.length) {
    const { data, error } = await context.db.rpc("claim_selected_phone_history", {
      p_phone: context.phone, p_customer_ids: input.customerIds,
    });
    if (error || !data?.ok) return { error: "These profiles changed. Please reload and choose again." };
  }
  const saved = await context.db.from("users").update({ phone: context.phone }).eq("id", context.user.id);
  if (saved.error) return { error: "Your phone could not be saved. Please retry." };
  const { error } = await context.auth.auth.updateUser({ data: { signup_phone_complete: true, signup_phone: context.phone } });
  if (error) return { error: "Signup could not be completed. Please retry." };
  revalidatePath("/", "layout");
  revalidatePath("/activity");
  const next = sanitizeAuthReturnPath(input.nextPath, "/activity");
  return { redirectTo: next.startsWith("/welcome/phone") ? "/activity" : next };
}
