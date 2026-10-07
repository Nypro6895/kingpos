"use server";

import { getCurrentBusinessContext } from "@/lib/current-context";
import {
  acceptStaffInviteByRequestId,
  declineStaffInviteByRequestId,
  cancelStaffSalonApplication,
  submitStaffSalonApplication,
  getStaffConnectionDashboard,
  searchPublicStaffApplicationSalons,
} from "@/lib/staff-salon-connections";
import { listMyOwnerTransferInvites } from "@/lib/owner-transfer";
import { respondOwnerInvite } from "@/app/my-place/owner-invite-actions";
import { revalidatePath } from "next/cache";

export async function loadSettingsConnections() {
  const context = await getCurrentBusinessContext();
  if (!context.user) throw new Error("Please sign in to manage connections.");
  const salons = context.workspaceOptions
    .filter(
      (w) => w.salonId && (w.salonMode === "manage" || w.salonMode === "staff"),
    )
    .map((w) => ({
      id: w.id,
      salonId: w.salonId!,
      name: w.salonName ?? w.label,
      role: w.roleLabel,
      mode: w.salonMode,
      description: w.description,
    }));
  const ownerInbox=await listMyOwnerTransferInvites().then(ownerInvites=>({ownerInvites,ownersError:null as string|null})).catch(e=>({ownerInvites:[],ownersError:e instanceof Error?e.message:"Could not load ownership invitations."}));
  try {
    const { requests } = await getStaffConnectionDashboard();
    return {
      ...ownerInbox,
      salons,
      requests,
      loadedAt: Date.now(),
      requestsError: null as string | null,
    };
  } catch (error) {
    return {
      ...ownerInbox,
      salons,
      requests: [],
      loadedAt: Date.now(),
      requestsError:
        error instanceof Error
          ? error.message
          : "Could not load invitations and applications.",
    };
  }
}

export async function searchSettingsConnectionSalons(input: {
  query: string;
  city: string;
  state: string;
}) {
  const context = await getCurrentBusinessContext();
  if (!context.user) throw new Error("Please sign in to search salons.");
  if (![input.query, input.city, input.state].some((value) => value.trim()))
    return [];
  return searchPublicStaffApplicationSalons(input);
}

export async function updateSettingsConnection(
  input:
    | { action: "accept" | "decline" | "cancel"; requestId: string }
    | { action: "owner-accept" | "owner-ignore"; requestId: string }
    | { action: "apply"; salonId: string; title: string; message: string },
) {
  try {
    const context = await getCurrentBusinessContext();
    if (!context.user) throw new Error("Please sign in to manage connections.");
    switch (input.action) {
      case "owner-accept":
      case "owner-ignore": {
        const result=await respondOwnerInvite(input.requestId,input.action==="owner-accept"?"accept":"ignore");
        if(result.error)throw new Error(result.error);
        break;
      }
      case "accept":
        await acceptStaffInviteByRequestId(input.requestId);
        break;
      case "decline":
        await declineStaffInviteByRequestId(input.requestId);
        break;
      case "cancel":
        await cancelStaffSalonApplication(input.requestId);
        break;
      case "apply":
        await submitStaffSalonApplication({
          salon_id: input.salonId,
          requested_job_title: input.title,
          message: input.message,
        });
        break;
      default:
        throw new Error("Invalid connection action.");
    }
    revalidatePath("/settings");
    revalidatePath("/staff/connections");
    if (input.action === "accept") revalidatePath("/", "layout");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error ? error.message : "Could not update connection.",
    };
  }
}
