"use server";

import { isOwnerMembership } from "@/lib/current-context";
import { getMyPlaceWorkspaceContext } from "@/lib/my-place-context";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import {
  getSalonProfileHref,
  updateCurrentSalonProfileIdentityMedia,
} from "@/lib/salon-profile";
import { SALON_SETTING_SELECT } from "@/lib/salon-settings";
import { syncCurrentSalonMapLocationAddressState } from "@/lib/location/salon-map-location";
import {
  acceptStaffInviteByRequestId,
  declineStaffInviteByRequestId,
  cancelStaffSalonApplication,
  revokeSalonStaffInvite,
  reviewStaffSalonApplication,
  searchPublicStaffApplicationSalons,
  submitStaffSalonApplication,
} from "@/lib/staff-salon-connections";
import type {
  PlaceAccountDetails,
  PlaceRequest,
  PlaceResult,
  PlaceSalonDetails,
} from "@/types/my-place";
import type { StaffConnectionDashboardRequest } from "@/types/staff-salon-connection";
import type { SalonSetting } from "@/types/salon-setting";
import { revalidatePath } from "next/cache";
import {
  disableSalon,
  reactivateSalon,
  getSalonLifecycle,
  getSalonClosureReview,
} from "@/lib/salon-lifecycle";

async function attempt<T>(work: () => Promise<T>): Promise<PlaceResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Unable to complete this action. Please try again.",
    };
  }
}

async function client() {
  // This client verifies authentication, user status and the app login session.
  // Targeted actions resolve their workspace separately, without loading it twice.
  const supabase = await createAuthenticatedSupabaseServerClient();
  if (!supabase) throw new Error("Please sign in again.");
  return { supabase };
}

function refreshPlaces() {
  revalidatePath("/my-place");
  revalidatePath("/", "layout");
}

function field(form: FormData, name: string, max = 200) {
  const value = form.get(name);
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > max)
    throw new Error(`${name.replaceAll("_", " ")} is too long.`);
  return text;
}

export async function createPlaceSalon(form: FormData) {
  return attempt(async () => {
    const context = await getMyPlaceWorkspaceContext(
      field(form, "workspace_id"),
    );
    if (
      context.workspaceType !== "account" ||
      !isOwnerMembership(context.currentMembership) ||
      context.currentAccount?.status !== "active"
    ) {
      throw new Error("Choose an active business account you own.");
    }
    const { supabase } = await client();
    const name = field(form, "name", 160);
    const key = field(form, "create_request_key");
    if (!name || !key)
      throw new Error("Salon name and creation key are required.");
    const { data, error } = await supabase.rpc("create_account_salon", {
      p_account_id: context.accountId,
      p_create_request_key: key,
      p_name: name,
      p_phone: field(form, "phone") || null,
      p_address_line1: field(form, "address_line1") || null,
      p_address_line2: field(form, "address_line2") || null,
      p_city: field(form, "city") || null,
      p_state: field(form, "state") || null,
      p_postal_code: field(form, "postal_code") || null,
      p_country: "US",
    });
    if (error) throw new Error(error.message);
    if (!data?.salon_id)
      throw new Error("Salon creation did not return a salon.");
    refreshPlaces();
    return { salonId: String(data.salon_id) };
  });
}

export async function getPlaceSalon(
  workspaceId: string,
): Promise<PlaceResult<PlaceSalonDetails>> {
  return attempt(async () => {
    const context = await getMyPlaceWorkspaceContext(workspaceId);
    const salon = context.currentSalon ?? context.currentStaffSalon;
    if (!salon || context.workspaceType !== "salon")
      throw new Error("Salon not available.");
    const { supabase } = await client();
    const { data: setting, error } = await supabase
      .from("salon_settings")
      .select(
        "business_name,phone,address_line1,address_line2,city,state,postal_code,country",
      )
      .eq("salon_id", salon.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const manage = context.salonMode === "manage" && salon.status === "active";
    return {
      salon: setting
        ? {
            ...salon,
            ...setting,
            name: setting.business_name,
            country: setting.country ?? salon.country,
          }
        : salon,
      canEdit:
        manage && (await hasPermission("salon_settings.manage", context)),
      canEditLogo:
        manage && (await hasPermission("salon_profile.manage", context)),
    };
  });
}

export async function savePlaceSalon(workspaceId: string, form: FormData) {
  return attempt(async () => {
    const context = await getMyPlaceWorkspaceContext(workspaceId);
    if (context.salonMode !== "manage" || !context.currentSalon)
      throw new Error("Choose a salon you manage.");
    await requirePermission("salon_settings.manage", context);
    const { supabase } = await client();
    const values = Object.fromEntries(
      [
        "name",
        "phone",
        "address_line1",
        "address_line2",
        "city",
        "state",
        "postal_code",
        "country",
      ].map((name) => [name, field(form, name)]),
    );
    const { error } = await supabase.rpc("my_place_update_salon", {
      p_salon_id: context.currentSalon.id,
      p_values: values,
    });
    if (error) throw new Error(error.message);
    const { data: setting } = await supabase
      .from("salon_settings")
      .select(SALON_SETTING_SELECT)
      .eq("salon_id", context.currentSalon.id)
      .single<SalonSetting>();
    if (setting) {
      // Saving succeeds even when the external geocoder is temporarily unavailable.
      try {
        await syncCurrentSalonMapLocationAddressState({ context, setting });
      } catch {
        console.warn(
          "My Place address saved; map refresh will need to be retried.",
        );
      }
    }
    revalidatePath("/explore");
    revalidatePath(getSalonProfileHref(context.currentSalon.id));
    refreshPlaces();
    return null;
  });
}

export async function savePlaceLogo(workspaceId: string, path: string | null) {
  return attempt(async () => {
    const context = await getMyPlaceWorkspaceContext(workspaceId);
    if (context.salonMode !== "manage")
      throw new Error("Choose a salon you manage.");
    await updateCurrentSalonProfileIdentityMedia(
      { kind: "logo", path, remove: path === null },
      context,
    );
    revalidatePath("/explore");
    refreshPlaces();
    return null;
  });
}

export async function getPlaceAccount(
  workspaceId: string,
): Promise<PlaceResult<PlaceAccountDetails>> {
  return attempt(async () => {
    const context = await getMyPlaceWorkspaceContext(workspaceId);
    if (context.workspaceType !== "account")
      throw new Error("Choose a business account.");
    const { supabase } = await client();
    const { data, error } = await supabase.rpc("my_place_account_details", {
      p_account_id: context.accountId,
    });
    if (error) throw new Error(error.message);
    return data as PlaceAccountDetails;
  });
}

export async function savePlaceMember(workspaceId: string, form: FormData) {
  return attempt(async () => {
    const context = await getMyPlaceWorkspaceContext(workspaceId);
    if (
      context.workspaceType !== "account" ||
      !isOwnerMembership(context.currentMembership)
    )
      throw new Error("Only business account owners can manage members.");
    const { supabase } = await client();
    const { error } = await supabase.rpc("my_place_save_member", {
      p_account_id: context.accountId,
      p_role_id: field(form, "role_id") || null,
      p_email: field(form, "email", 320) || null,
      p_membership_id: field(form, "membership_id") || null,
      p_operation: field(form, "operation"),
    });
    if (error) throw new Error(error.message);
    refreshPlaces();
    return null;
  });
}

export async function getPlaceRequests(): Promise<PlaceResult<PlaceRequest[]>> {
  return attempt(async () => {
    const { supabase } = await client();
    const [personal, accountInvites, managed] = await Promise.all([
      supabase.rpc("list_my_staff_salon_connection_requests"),
      supabase.rpc("my_place_account_invitations"),
      supabase.rpc("my_place_staff_requests"),
    ]);
    if (personal.error) throw new Error(personal.error.message);
    if (accountInvites.error) throw new Error(accountInvites.error.message);
    if (managed.error) throw new Error(managed.error.message);
    const requests: PlaceRequest[] = (
      (personal.data ?? []) as StaffConnectionDashboardRequest[]
    ).map((r) => ({
      id: r.id,
      kind: r.direction === "salon_invite" ? "invitation" : "application",
      label: r.salon_name,
      detail: [r.requested_job_title ?? r.staff_job_title, r.city, r.state]
        .filter(Boolean)
        .join(" · "),
      message: r.message,
      status: r.status,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
    for (const request of (managed.data ?? []) as PlaceRequest[]) {
      if (!requests.some((item) => item.id === request.id))
        requests.push(request);
    }
    requests.push(...((accountInvites.data as PlaceRequest[]) ?? []));
    const now = Date.now();
    return requests
      .map((r) =>
        r.status === "pending" &&
        r.expiresAt &&
        new Date(r.expiresAt).getTime() <= now
          ? { ...r, status: "expired" }
          : r,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export async function respondPlaceRequest(id: string, operation: string) {
  return attempt(async () => {
    const { supabase } = await client();
    switch (operation) {
      case "accept_invite":
        await acceptStaffInviteByRequestId(id);
        break;
      case "decline_invite":
        await declineStaffInviteByRequestId(id);
        break;
      case "cancel_application":
        await cancelStaffSalonApplication(id);
        break;
      case "revoke_invite":
        await revokeSalonStaffInvite(id);
        break;
      case "approve_application":
        await reviewStaffSalonApplication({
          request_id: id,
          decision: "accepted",
        });
        break;
      case "decline_application":
        await reviewStaffSalonApplication({
          request_id: id,
          decision: "declined",
        });
        break;
      case "accept_account":
      case "decline_account": {
        const { error } = await supabase.rpc(
          "my_place_respond_account_invitation",
          { p_membership_id: id, p_accept: operation === "accept_account" },
        );
        if (error) throw new Error(error.message);
        break;
      }
      default:
        throw new Error("Unknown request action.");
    }
    revalidatePath("/staff");
    revalidatePath("/staff/connections");
    revalidatePath("/notifications");
    refreshPlaces();
    return null;
  });
}

export async function searchPlaceSalons(query: string) {
  return attempt(async () => {
    await client();
    if (query.trim().length < 2)
      throw new Error("Enter at least two characters to search.");
    return searchPublicStaffApplicationSalons({
      query: query.trim().slice(0, 160),
    });
  });
}

export async function applyToPlaceSalon(form: FormData) {
  return attempt(async () => {
    await submitStaffSalonApplication({
      salon_id: field(form, "salon_id"),
      requested_job_title: field(form, "requested_job_title"),
      message: field(form, "message", 2000),
    });
    refreshPlaces();
    return null;
  });
}

// Same authorization and lifecycle services as Salon Settings; no new state or policy.
async function lifecycleContext(workspaceId: string) {
  const context = await getMyPlaceWorkspaceContext(workspaceId);
  if (context.salonMode !== "manage" || !context.currentSalon)
    throw new Error("Choose an owner salon workspace first.");
  await requirePermission("salon_settings.manage", context);
  if (
    !isOwnerMembership(context.currentMembership) &&
    !context.permissionCodes.includes("account.manage")
  )
    throw new Error("Only an Owner can change salon lifecycle.");
  return context;
}

export async function getPlaceLifecycleReview(workspaceId: string) {
  return attempt(async () => {
    const context = await lifecycleContext(workspaceId);
    const salonId = context.currentSalon!.id;
    const [state, review] = await Promise.all([
      getSalonLifecycle(salonId),
      getSalonClosureReview({ context, salonId }),
    ]);
    if (!state || state.lifecycleStatus === "permanently_closed")
      throw new Error(
        "This salon is permanently closed. Standard reactivation is not available.",
      );
    return { status: state.lifecycleStatus, counts: review.counts };
  });
}

export async function setPlaceSalonActivity(
  workspaceId: string,
  form: FormData,
) {
  return attempt(async () => {
    const context = await lifecycleContext(workspaceId);
    const salonId = context.currentSalon!.id;
    const state = await getSalonLifecycle(salonId);
    const operation = field(form, "operation");
    if (form.get("acknowledged") !== "on")
      throw new Error("Confirm the change to salon activity.");
    const reason = field(form, "reason", 1000) || null;
    if (operation === "pause" && state?.lifecycleStatus === "active")
      await disableSalon({ salonId, reason });
    else if (operation === "resume" && state?.lifecycleStatus === "disabled")
      await reactivateSalon({ salonId, reason });
    else
      throw new Error(
        "The salon status has changed. Close this panel and review its current status.",
      );
    revalidatePath("/salon-settings");
    refreshPlaces();
    return null;
  });
}
