"use server";


import {
  getCurrentBusinessContext,
  isOwnerMembership,
  isSalonManageContext,
} from "@/lib/current-context";
import {
  hasPermission,
  requirePermission,
  getAccountPermissionSet,
} from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import {
  getCurrentSalonSetting,
  getCurrentSalonDiscoveryReadiness,
  updateCurrentSalonSetting,
} from "@/lib/salon-settings";
import {
  getCurrentSalonOperatingHoursSettings,
  updateCurrentSalonOperatingHours,
  createCurrentSalonSpecialHours,
  deleteCurrentSalonSpecialHours,
} from "@/lib/salon-operating-status";
import { getCurrentSalonServicesWorkspace } from "@/lib/services";
import { getCurrentSalonBookingSetup } from "@/lib/booking-setup";
import {
  BOOKING_SETTINGS_SELECT,
  defaultBookingSettings,
} from "@/lib/bookings";
import {
  getCurrentSalonStaffDirectory,
  createStaff,
  updateStaffDirectoryBatch,
} from "@/lib/staff";
import { getSalonStaffConnectionRequests } from "@/lib/staff-salon-connections";
import {
  getPayrollSettingsWorkspace,
  updateSalonPayrollSetting,
  updateStaffPayrollSetting,
} from "@/lib/payroll";
import { getCurrentSalonPosSettings } from "@/lib/pos-settings";
import { getCurrentSalonPortablePosAccessState } from "@/lib/pos-portable-access";
import {
  getSalonOwnerRoster,
  revokeOwnerTransferInvite,
  relinquishSalonOwnership,
} from "@/lib/owner-transfer";
import {
  getSalonLifecycle,
  getSalonClosureReview,
  disableSalon,
  reactivateSalon,
  closeSalonPermanently,
} from "@/lib/salon-lifecycle";
import { withSettingsTarget } from "@/lib/settings-target-context";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import {
  getStaffProfileAvatarUrl,
  getStaffProfileDisplayName,
} from "@/lib/staff-profile";
import { loadRecoveryBackOfficeOverview } from "@/lib/account-security-backoffice";
import {
  updateBookingSettingsAction,
  type UpdateBookingSettingsInput,
} from "@/app/bookings/actions";
import { createOwnerTransferInviteAction } from "@/app/account/actions";
import {
  createSalonStaffInviteAction,
  searchStaffAccountExactAction,
  reviewStaffSalonApplicationAction,
  resendSalonStaffInviteAction,
  revokeSalonStaffInviteAction,
} from "@/app/staff/actions";
import { revalidatePath } from "next/cache";
import type {
  BookingSettings,
  StaffAvailabilityRule,
  StaffTimeBlock,
} from "@/types/booking";
import type { UpdateSalonSettingInput } from "@/types/salon-setting";
import type {
  UpdateSalonOperatingHoursInput,
  CreateSalonSpecialHoursInput,
} from "@/types/salon-operating-status";
import type {
  CreateStaffInput,
  UpdateStaffDirectoryBatchChange,
} from "@/types/staff";
import type { Role } from "@/types/role";
import { getCurrentSalonMapLocationState } from "@/lib/location/salon-map-location";
import { getTodayQuickAccessConfiguration } from "@/lib/today-quick-accesses";
import { getSalonProfileMediaUrl, getCurrentSalonProfileIdentitySettings } from "@/lib/salon-profile";
import { getSettingsOwnerHistory } from "@/lib/settings-owner-history";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type DirectSettingsKind =
  | "salon-profile"
  | "public-profile"
  | "shortcuts"
  | "services"
  | "booking"
  | "staff-team"
  | "payroll"
  | "pos-display"
  | "ownership"
  | "close-salon"
  | "staff-workspace"
  | "staff-schedule"
  | "recovery-back-office"
  | "roles"
  | "permissions";

async function salonContext(expectedSalonId?: string) {
  const context = await getCurrentBusinessContext();
  if (!context.user || !isSalonManageContext(context) || !context.currentSalon)
    throw new Error(
      "Choose a salon in Salon List before editing these settings.",
    );
  if (expectedSalonId && context.currentSalon.id !== expectedSalonId)
    throw new Error(
      "The selected salon changed. Reload these settings before saving.",
    );
  const supabase = await createAuthenticatedSupabaseServerClient();
  if (!supabase)
    throw new Error("Your session is unavailable. Please sign in again.");
  return { context, supabase, salon: context.currentSalon };
}

export async function loadDirectSettings(kind: DirectSettingsKind, targetSalonId?: string) {
 return withSettingsTarget(targetSalonId, async () => {
  if (kind === "recovery-back-office") {
    const overview = await loadRecoveryBackOfficeOverview();
    if (!overview?.authorized)
      throw new Error("You do not have access to recovery support.");
    return { kind, overview } as const;
  }
  if (kind === "roles" || kind === "permissions") {
    const context = await getCurrentBusinessContext();
    if (
      !context.user ||
      !context.currentAccount ||
      !isOwnerMembership(context.currentMembership)
    )
      throw new Error("Only an account owner can review access rules.");
    const supabase = await createAuthenticatedSupabaseServerClient();
    if (!supabase) throw new Error("Your session is unavailable.");
    const { data, error } = await supabase
      .from("roles")
      .select(
        "id,account_id,code,name,description,is_system,created_at,updated_at",
      )
      .eq("account_id", context.currentAccount.id);
    if (error) throw new Error(error.message);
    const catalog = await getAccountPermissionSet(
      context.currentAccount.id,
      (data ?? []) as Role[],
    );
    return { kind, catalog } as const;
  }
  if (kind === "staff-workspace" || kind === "staff-schedule") {
    const { context, staff, supabase } = await getStaffPortalIdentity(await getCurrentBusinessContext());
    if (!staff || !supabase || !context.currentSalon)
      throw new Error(
        "No active staff profile is connected to your selected salon.",
      );
    const { data: rules, error: rulesError } = await supabase
      .from("staff_availability_rules")
      .select("*")
      .eq("salon_id", context.currentSalon.id)
      .or(`staff_id.eq.${staff.id},staff_id.is.null`)
      .eq("is_active", true);
    const { data: blocks, error: blocksError } = await supabase
      .from("staff_time_blocks")
      .select("*")
      .eq("salon_id", context.currentSalon.id)
      .eq("staff_id", staff.id)
      .eq("is_active", true)
      .gte("ends_at", new Date().toISOString());
    if (rulesError || blocksError)
      throw new Error(rulesError?.message ?? blocksError?.message);
    const hours = await supabase
      .from("booking_settings")
      .select("timezone_iana")
      .eq("salon_id", context.currentSalon.id)
      .maybeSingle();
    if (hours.error) throw new Error(hours.error.message);
    return {
      kind,
      salonId: context.currentSalon.id,
      salonName: context.currentSalon.name,
      staff,
      displayName: getStaffProfileDisplayName(staff, context.user),
      avatarUrl: getStaffProfileAvatarUrl({
        staffProfilePhotoPath: staff.public_profile_photo_path,
        accountAvatarUrl: context.user?.avatar_url,
      }),
      availabilityRules: (rules ?? []) as StaffAvailabilityRule[],
      timeBlocks: (blocks ?? []) as StaffTimeBlock[],
      timezone: hours.data?.timezone_iana ?? "America/Chicago",
    } as const;
  }
  const { context, supabase, salon } = await salonContext();
  const common = { salonId: salon.id, salonName: salon.name };
  switch (kind) {
    case "public-profile": {
      const setting=await getCurrentSalonProfileIdentitySettings(context);
      const canManageSalon=await hasPermission('salon_settings.manage',context);
      return {kind,...common,setting,profileIdentity:setting,canManageSalon,canManage:await hasPermission('salon_profile.manage',context),readiness:canManageSalon?await getCurrentSalonDiscoveryReadiness(setting):{canEnable:false,missingLabels:[]},logoUrl:getSalonProfileMediaUrl(setting.public_profile_logo_path),coverUrl:getSalonProfileMediaUrl(setting.public_profile_cover_path)} as const;
    }
    case "salon-profile": {
      const { setting } = await getCurrentSalonSetting();
      if (!setting) throw new Error("Salon settings are unavailable.");
      const [hours, readiness, canManage] = await Promise.all([
        getCurrentSalonOperatingHoursSettings(),
        getCurrentSalonDiscoveryReadiness(setting),
        hasPermission("salon_settings.manage", context),
      ]);
      const mapLocation = await getCurrentSalonMapLocationState({context,setting});
      return { kind, ...common, setting, hours, readiness, canManage, mapLocation } as const;
    }
    case "shortcuts":
      return {kind,...common,configuration:await getTodayQuickAccessConfiguration(context)} as const;
    case "services":
      return {
        kind,
        ...common,
        workspace: await getCurrentSalonServicesWorkspace(context),
      } as const;
    case "booking": {
      await requirePermission("booking.view", context);
      const { data, error } = await supabase
        .from("booking_settings")
        .select(BOOKING_SETTINGS_SELECT)
        .eq("salon_id", salon.id)
        .maybeSingle<BookingSettings>();
      if (error) throw new Error(error.message);
      return {
        kind,
        ...common,
        settings:
          data ??
          defaultBookingSettings({
            accountId: context.accountId!,
            salonId: salon.id,
            timezone: "America/Chicago",
          }),
        setup: await getCurrentSalonBookingSetup(context),
        canManage: await hasPermission("booking.manage", context),
      } as const;
    }
    case "staff-team": {
      const canManage=await hasPermission("staff.manage",context);
      const [directory, requests] = await Promise.all([
        getCurrentSalonStaffDirectory(),
        canManage?getSalonStaffConnectionRequests():Promise.resolve({requests:[]}),
      ]);
      return {
        kind,
        ...common,
        staff: directory.staff,
        requests: requests.requests,
        canManage,
        canManagePublicTeam:await hasPermission("salon_settings.manage",context),
      } as const;
    }
    case "payroll": {
      const payroll = await getPayrollSettingsWorkspace();
      return {
        kind,
        ...common,
        schedule: payroll.salonPayrollSetting,
        staff: payroll.staffPayrollSettings,
        canManage: payroll.access.canManagePayroll,
        today: new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Chicago",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
      } as const;
    }
    case "pos-display": {
      await requirePermission("tickets.view", context);
      const [view, portable, snapshot] = await Promise.all([
        getCurrentSalonPosSettings(context),
        getCurrentSalonPortablePosAccessState(context),
        supabase
          .from("pos_settings")
          .select("*")
          .eq("salon_id", salon.id)
          .maybeSingle(),
      ]);
      if (snapshot.error) throw new Error(snapshot.error.message);
      const manifest = await readFile(
        path.join(process.cwd(), "public/desktop-updates/latest.yml"),
        "utf8",
      ).catch(() => "");
      const version = manifest.match(/^version:\s*["']?([\d.]+)/m)?.[1] ?? "";
      const installer = /^\d+\.\d+\.\d+$/.test(version)
        ? `/desktop-updates/${encodeURIComponent(`KingPOS Portable Test-Setup-${version}.exe`)}`
        : null;
      return {
        kind,
        ...common,
        view,
        portable,
        installer,
        snapshot: (snapshot.data ?? {}) as Record<string, unknown>,
        canManage: await hasPermission("tickets.manage", context),
        canManagePortable: await hasPermission("salon_settings.manage", context),
      } as const;
    }
    case "ownership": {
      if (!isOwnerMembership(context.currentMembership))
        throw new Error("Only a salon owner can manage ownership.");
      const roster = await getSalonOwnerRoster(salon.id);
      let history: Awaited<ReturnType<typeof getSettingsOwnerHistory>> = [], historyError: string | null = null;
      try { history=await getSettingsOwnerHistory(salon.id); } catch(e) { historyError=e instanceof Error?e.message:"Could not load former owners."; }
      const { data: invites, error } = await supabase
        .from("salon_owner_transfer_invites")
        .select("id,target_email_normalized,mode,expires_at")
        .eq("salon_id", salon.id)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .returns<
          Array<{
            id: string;
            target_email_normalized: string | null;
            mode: string;
            expires_at: string;
          }>
        >();
      if (error) throw new Error(error.message);
      return { kind, ...common, roster, history, historyError, invites: invites ?? [] } as const;
    }
    case "close-salon": {
      if (!isOwnerMembership(context.currentMembership))
        throw new Error("Only a salon owner can change salon status.");
      const [lifecycle, review] = await Promise.all([
        getSalonLifecycle(salon.id),
        getSalonClosureReview({ context, salonId: salon.id }),
      ]);
      if (!lifecycle) throw new Error("Salon status is unavailable.");
      const [appointments,tickets]=await Promise.all([
        supabase.from("bookings").select("id,status,start_at,end_at,updated_at,customer:customers(name,phone),staff:staff(display_name)").eq("salon_id",salon.id).in("status",["pending","confirmed","checked_in","in_service","scheduled"]).or(`start_at.gte.${new Date().toISOString()},status.in.(pending,checked_in,in_service)`).order("start_at"),
        supabase.from("pos_tickets").select("id,ticket_number,status,opened_at,updated_at,customer:customers(name,phone)").eq("salon_id",salon.id).eq("status","open").order("opened_at"),
      ]);
      if(appointments.error||tickets.error)throw new Error(appointments.error?.message??tickets.error?.message);
      const closureDetails={appointments:appointments.data??[],tickets:tickets.data??[]};
      return { kind, ...common, lifecycle, review, closureDetails } as const;
    }
    default:
      throw new Error("Unknown settings section.");
  }

 }, kind === "staff-workspace" || kind === "staff-schedule" ? "staff" : "manage");
}

export async function saveDirectSalonProfile(
  salonId: string,
  input: UpdateSalonSettingInput,
) {
 return withSettingsTarget(salonId, async () => {
  try {
    await salonContext(salonId);
    const { setting } = await getCurrentSalonSetting();
    if (!setting) throw new Error("Salon settings are unavailable.");
    await updateCurrentSalonSetting({ ...setting, ...input });
    revalidatePath("/", "layout");
    revalidatePath("/explore");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Could not save salon settings.",
    };
  }

 }, "manage");
}

export async function saveDirectHours(
  salonId: string,
  input: UpdateSalonOperatingHoursInput,
) {
 return withSettingsTarget(salonId, async () => {
  try {
    await salonContext(salonId);
    await updateCurrentSalonOperatingHours(input);
    revalidatePath("/", "layout");
    revalidatePath("/explore");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not save hours.",
    };
  }

 }, "manage");
}
export async function saveDirectSpecialHours(
  salonId: string,
  input: CreateSalonSpecialHoursInput | { deleteId: string },
) {
 return withSettingsTarget(salonId, async () => {
  try {
    await salonContext(salonId);
    if ("deleteId" in input)
      await deleteCurrentSalonSpecialHours(input.deleteId);
    else await createCurrentSalonSpecialHours(input);
    revalidatePath("/", "layout");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Could not save special hours.",
    };
  }

 }, "manage");
}
export async function saveDirectBooking(
  salonId: string,
  input: UpdateBookingSettingsInput,
) {
 return withSettingsTarget(salonId, async () => {
  try {
    await salonContext(salonId);
    const result = await updateBookingSettingsAction(input);
    return result.ok
      ? { ok: true as const }
      : { ok: false as const, error: result.message };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Could not save booking rules.",
    };
  }

 }, "manage");
}
export async function saveDirectStaff(
  salonId: string,
  input: CreateStaffInput | UpdateStaffDirectoryBatchChange,
) {
 return withSettingsTarget(salonId, async () => {
  try {
    await salonContext(salonId);
    if ("staff_id" in input)
      await updateStaffDirectoryBatch({ changes: [input] });
    else await createStaff(input);
    revalidatePath("/", "layout");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not save staff.",
    };
  }

 }, "manage");
}
export async function runDirectStaffRequest(
  salonId: string,
  input:
    | { action: "invite"; email: string; name: string; staffId?: string }
    | { action: "accept" | "decline" | "resend" | "revoke"; requestId: string },
) {
 return withSettingsTarget(salonId, async () => {
  try {
    await salonContext(salonId);
    let inviteAccountId: string | undefined;
    if (input.action === "invite") {
      const match = await searchStaffAccountExactAction({ email: input.email });
      if (!match.ok) return { ok: false as const, error: match.error.message };
      if (match.data.status === "ambiguous") return { ok: false as const, error: "This email matches multiple accounts. Use a unique verified email." };
      if (match.data.status === "found") inviteAccountId = match.data.account.id;
    }
    const result =
      input.action === "invite"
        ? await createSalonStaffInviteAction({
            mode: inviteAccountId ? "existing_account" : "new_account",
            account_user_id: inviteAccountId,
            display_name: input.name,
            email: input.email,
            is_active: true,
            staff_id: input.staffId,
          })
        : input.action === "resend"
          ? await resendSalonStaffInviteAction({ request_id: input.requestId })
          : input.action === "revoke"
            ? await revokeSalonStaffInviteAction({
                request_id: input.requestId,
              })
            : await reviewStaffSalonApplicationAction({
                decision: input.action === "accept" ? "accepted" : "declined",
                request_id: input.requestId,
              });
    if (!result.ok) return { ok: false as const, error: result.error.message };
    const details = result.data;
    if (details && typeof details === "object" && "invite_token" in details) {
      const delivery =
        "email_delivery" in details ? details.email_delivery : null;
      return {
        ok: true as const,
        inviteUrl: `/staff/invite/${encodeURIComponent(String(details.invite_token))}`,
        message:
          delivery?.status === "sent"
            ? "Invitation email sent."
            : `Invitation created. ${delivery && "reason" in delivery ? delivery.reason : "Use the invitation link to connect the account."}`,
      };
    }
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Could not update staff connection.",
    };
  }

 }, "manage");
}
export async function saveDirectPayroll(
  salonId: string,
  input:
    | Parameters<typeof updateSalonPayrollSetting>[0]
    | Parameters<typeof updateStaffPayrollSetting>[0],
) {
 return withSettingsTarget(salonId, async () => {
  try {
    await salonContext(salonId);
    if ("staffId" in input) await updateStaffPayrollSetting(input);
    else await updateSalonPayrollSetting(input);
    revalidatePath("/", "layout");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Could not save payroll settings.",
    };
  }

 }, "manage");
}
export async function runDirectOwnership(salonId: string, form: FormData) {
 return withSettingsTarget(salonId, async () => {
  try {
    const { context } = await salonContext(salonId);
    if (!isOwnerMembership(context.currentMembership))
      throw new Error("Only a salon owner can manage ownership.");
    if (form.get("action") === "leave") {
      if (form.get("confirmed") !== "on")
        throw new Error("Confirm leaving ownership before continuing.");
      await relinquishSalonOwnership({
        salonId,
        reason: "Owner voluntarily left salon ownership.",
      });
      revalidatePath("/", "layout");
      return { ok: true as const, message: "You have left salon ownership." };
    }
    if (form.get("action") === "revoke") {
      const supabase = await createAuthenticatedSupabaseServerClient();
      if (!supabase) throw new Error("Your session is unavailable.");
      const inviteId = String(form.get("invite_id") ?? "");
      const { data, error } = await supabase
        .from("salon_owner_transfer_invites")
        .select("id")
        .eq("id", inviteId)
        .eq("salon_id", salonId)
        .maybeSingle();
      if (error || !data)
        throw new Error(error?.message ?? "This invitation is unavailable.");
      await revokeOwnerTransferInvite(inviteId);
      revalidatePath("/", "layout");
      return { ok: true as const };
    }
    const result = await createOwnerTransferInviteAction({
      salon_id: salonId,
      mode: String(form.get("mode")),
      recipient_email: String(form.get("email")),
      message: String(form.get("message") ?? ""),
      relinquish_on_accept: form.get("relinquish") === "on",
    });
    return result.error
      ? { ok: false as const, error: result.error }
      : {
          ok: true as const,
          message: result.message,
          inviteUrl: result.inviteUrl,
        };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error ? error.message : "Could not update ownership.",
    };
  }

 }, "manage");
}
export async function runDirectLifecycle(
  salonId: string,
  action: "disable" | "reactivate" | "close",
  form: FormData,
) {
 return withSettingsTarget(salonId, async () => {
  try {
    const { context, salon } = await salonContext(salonId);
    if (!isOwnerMembership(context.currentMembership))
      throw new Error("Only a salon owner can change salon status.");
    if (form.get("confirmed") !== "on")
      throw new Error("Confirm this action before continuing.");
    const lifecycle = await getSalonLifecycle(salonId);
    if (!lifecycle) throw new Error("Salon status is unavailable.");
    const reason = String(form.get("reason") ?? "").trim() || null;
    if (action === "close") {
      if (
        form.get("confirmation_name") !== salon.name ||
        form.get("backup_acknowledged") !== "on"
      )
        throw new Error(
          "Type the salon name exactly and acknowledge your backup choice.",
        );
      const review = await getSalonClosureReview({ context, salonId });
      if (!review.canClose)
        throw new Error(
          "Resolve future bookings, pending appointments and open POS tickets before closing.",
        );
      await closeSalonPermanently({ salonId, reason });
    } else if (action === "disable") {
      if (lifecycle.lifecycleStatus !== "active")
        throw new Error("Only an active salon can be disabled.");
      await disableSalon({ salonId, reason });
    } else if (action === "reactivate") {
      if (lifecycle.lifecycleStatus !== "disabled")
        throw new Error("Only a disabled salon can be reactivated.");
      await reactivateSalon({ salonId, reason });
    } else throw new Error("Unknown salon action.");
    revalidatePath("/", "layout");
    revalidatePath("/explore");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Could not change salon status.",
    };
  }

 }, "manage");
}
