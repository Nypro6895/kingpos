"use server";

import {
  getCurrentBusinessContext,
  getManageWorkspaceId,
  isOwnerMembership,
  setNormalizedWorkspaceContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import {
  getCurrentSalonSetting,
  updateCurrentSalonSetting,
} from "@/lib/salon-settings";
import type { BusinessClaimMatch } from "@/lib/business-claims";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

function accountOptions(context: CurrentBusinessContext) {
  return context.availableAccounts.filter(
    (account) =>
      context.accountMemberships.some((m) => m.account_id === account.id) ||
      context.workspaceOptions.some(
        (w) => w.accountId === account.id && w.salonMode === "manage",
      ),
  );
}

function targetContext(
  context: CurrentBusinessContext,
  accountId: string,
  salonId: string,
): CurrentBusinessContext {
  const account = accountOptions(context).find((a) => a.id === accountId);
  const salon = context.availableManageSalons.find(
    (s) => s.id === salonId && s.account_id === accountId,
  );
  const workspace = context.workspaceOptions.find(
    (w) => w.id === getManageWorkspaceId(salonId) && w.accountId === accountId,
  );
  const membership =
    context.salonMemberships.find((m) => m.salon_id === salonId && m.status === "active") ??
    context.accountMemberships.find((m) => m.account_id === accountId && m.status === "active");
  if (!context.user || !account || !salon || !workspace || !membership)
    throw new Error("You no longer have access to this salon.");
  return {
    ...context,
    accountId,
    currentAccount: account,
    currentSalon: salon,
    currentBusiness: { ...salon, account_id: accountId },
    currentMembership: membership,
    currentWorkspace: workspace,
    workspaceType: "salon",
    salonMode: "manage",
    salonId,
    businessId: salonId,
  };
}

export async function loadSettingsSalonList(requestedAccountId?: string) {
  const context = await getCurrentBusinessContext();
  if (!context.user) throw new Error("Please sign in to manage salons.");
  const accounts = accountOptions(context);
  const account =
    accounts.find((a) => a.id === (requestedAccountId ?? context.accountId)) ??
    (!requestedAccountId ? accounts[0] : null);
  if (!account) throw new Error("Choose a business account you can access.");
  const supabase = await createAuthenticatedSupabaseServerClient();
  if (!supabase)
    throw new Error("Salon management is temporarily unavailable.");
  const salons = context.availableManageSalons.filter(
    (s) => s.account_id === account.id,
  );
  const { data: settings, error } = salons.length
    ? await supabase
        .from("salon_settings")
        .select(
          "salon_id,business_name,phone,address_line1,address_line2,city,state,postal_code,country",
        )
        .in(
          "salon_id",
          salons.map((s) => s.id),
        )
    : { data: [], error: null };
  if (error) throw new Error(error.message);
  const rows = await Promise.all(
    salons.map(async (salon) => {
      const setting = settings?.find((s) => s.salon_id === salon.id);
      const target = targetContext(context, account.id, salon.id);
      return {
        ...salon,
        ...(setting ? { ...setting, name: setting.business_name } : {}),
        canEdit: await hasPermission("salon_settings.manage", target),
        canSelect: Boolean(target.currentWorkspace),
        isCurrent:
          context.salonMode === "manage" && salon.id === context.salonId,
      };
    }),
  );
  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    accountId: account.id,
    salons: rows.sort((a, b) => a.name.localeCompare(b.name)),
    canCreate:
      account.status === "active" &&
      context.accountMemberships.some(
        (m) => m.account_id === account.id && m.status === "active" && isOwnerMembership(m),
      ),
    createRequestKey: randomUUID(),
  };
}

export async function saveSettingsSalon(
  accountId: string,
  salonId: string,
  form: FormData,
) {
  try {
    const context = targetContext(
      await getCurrentBusinessContext(),
      accountId,
      salonId,
    );
    const { setting } = await getCurrentSalonSetting(context);
    if (!setting) throw new Error("Could not load salon settings.");
    const text = (key: string) => String(form.get(key) ?? "").trim();
    await updateCurrentSalonSetting(
      {
        ...setting,
        business_name: text("name"),
        phone: text("phone") || null,
        address_line1: text("address_line1") || null,
        address_line2: text("address_line2") || null,
        city: text("city") || null,
        state: text("state") || null,
        postal_code: text("postal_code") || null,
      },
      context,
    );
    revalidatePath("/settings");
    revalidatePath("/salons");
    revalidatePath("/explore");
    revalidatePath("/", "layout");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not save salon.",
    };
  }
}

export async function selectSettingsSalon(accountId: string, salonId: string) {
  try {
    const target = targetContext(
      await getCurrentBusinessContext(),
      accountId,
      salonId,
    );
    await setNormalizedWorkspaceContext(target.currentWorkspace!);
    revalidatePath("/", "layout");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not select salon.",
    };
  }
}

export async function createSettingsSalon(
  accountId: string,
  requestKey: string,
  form: FormData,
) {
  try {
    const context = await getCurrentBusinessContext();
    const account = context.accountMemberships.find(
      (m) => m.account_id === accountId && m.status === "active" && isOwnerMembership(m),
    )?.account;
    if (!context.user || !account || account.status !== "active")
      throw new Error(
        "You do not have permission to create a salon in this account.",
      );
    const supabase = await createAuthenticatedSupabaseServerClient();
    if (!supabase)
      throw new Error("Salon management is temporarily unavailable.");
    const text = (key: string) => String(form.get(key) ?? "").trim();
    if (!text("name")) throw new Error("Salon name is required.");
    if (!/^[0-9a-f-]{36}$/i.test(requestKey))
      throw new Error("Please reload the salon list before creating a salon.");
    const { data: matches, error: matchError } = await supabase.rpc(
      "find_business_claim_matches",
      {
        p_name: text("name"),
        p_phone: text("phone"),
        p_address: text("address_line1"),
        p_unit: text("address_line2"),
        p_city: text("city"),
        p_state: text("state"),
      },
    );
    if (matchError)
      throw new Error("Could not check existing salons. Please try again.");
    if (
      Array.isArray(matches) &&
      matches.length &&
      text("duplicate_acknowledged") !== "yes"
    )
      return {
        ok: false as const,
        error:
          "An existing salon may match. Review it before creating a different salon.",
        matches: matches as BusinessClaimMatch[],
      };
    const { data, error } = await supabase.rpc(
      "create_account_salon_with_owner_staff",
      {
        p_account_id: accountId,
        p_create_request_key: requestKey,
        p_name: text("name"),
        p_phone: text("phone") || null,
        p_address_line1: text("address_line1") || null,
        p_address_line2: text("address_line2") || null,
        p_city: text("city") || null,
        p_state: text("state") || null,
        p_postal_code: text("postal_code") || null,
        p_country: "US",
        p_owner_is_staff: text("owner_is_staff") === "yes",
      },
    );
    if (error || !data?.salon_id)
      throw new Error(error?.message ?? "Could not create salon.");
    revalidatePath("/", "layout");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not create salon.",
    };
  }
}
