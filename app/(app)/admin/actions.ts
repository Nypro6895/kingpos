"use server";

import {
  updatePlatformAdminBusinessProfile,
  updatePlatformAdminBusinessStatus,
} from "@/lib/platform-admin/businesses";
import {
  updatePlatformAdminLocationProfile,
  updatePlatformAdminLocationStatus,
} from "@/lib/platform-admin/locations";
import { createPlatformAdminNote } from "@/lib/platform-admin/notes";
import {
  assignPlatformAdminReport,
  closePlatformAdminReport,
  createPlatformAdminReport,
  resolvePlatformAdminReport,
  updatePlatformAdminReport,
} from "@/lib/platform-admin/reports";
import {
  createPlatformAdminMembership,
  updatePlatformAdminMembership,
} from "@/lib/platform-admin/team";
import {
  restorePlatformAdminUser,
  suspendPlatformAdminUser,
  updatePlatformAdminUserProfile,
} from "@/lib/platform-admin/users";
import {
  readFormString,
  readReason,
  readRequiredFormString,
} from "@/lib/platform-admin/validation";
import type { PlatformAdminNoteTargetType } from "@/lib/platform-admin/notes";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function revalidateAdminPaths(...paths: string[]) {
  revalidatePath("/admin");

  for (const path of paths) {
    revalidatePath(path);
  }
}

function readNoteTargetType(value: string): PlatformAdminNoteTargetType {
  if (
    value === "business" ||
    value === "location" ||
    value === "report" ||
    value === "team_membership" ||
    value === "user"
  ) {
    return value;
  }

  throw new Error("Invalid note target type.");
}

export async function updateAdminUserProfileAction(formData: FormData) {
  const userId = readRequiredFormString(formData, "user_id", "User ID");

  await updatePlatformAdminUserProfile({
    displayName: readFormString(formData, "display_name"),
    firstName: readFormString(formData, "first_name"),
    lastName: readFormString(formData, "last_name"),
    phone: readFormString(formData, "phone"),
    reason: readReason(formData),
    userId,
  });

  revalidateAdminPaths("/admin/users", `/admin/users/${userId}`);
}

export async function suspendAdminUserAction(formData: FormData) {
  const userId = readRequiredFormString(formData, "user_id", "User ID");

  await suspendPlatformAdminUser({
    reason: readReason(formData),
    userId,
  });

  revalidateAdminPaths("/admin/users", `/admin/users/${userId}`, "/admin/team");
}

export async function restoreAdminUserAction(formData: FormData) {
  const userId = readRequiredFormString(formData, "user_id", "User ID");

  await restorePlatformAdminUser({
    reason: readReason(formData),
    userId,
  });

  revalidateAdminPaths("/admin/users", `/admin/users/${userId}`, "/admin/team");
}

export async function updateAdminBusinessProfileAction(formData: FormData) {
  const businessId = readRequiredFormString(formData, "business_id", "Business ID");

  await updatePlatformAdminBusinessProfile({
    businessId,
    legalName: null,
    name: readRequiredFormString(formData, "name", "Business name"),
    reason: readReason(formData),
  });

  revalidateAdminPaths("/admin/businesses", `/admin/businesses/${businessId}`);
}

export async function updateAdminBusinessStatusAction(formData: FormData) {
  const businessId = readRequiredFormString(formData, "business_id", "Business ID");

  await updatePlatformAdminBusinessStatus({
    businessId,
    reason: readReason(formData),
    status: readRequiredFormString(formData, "status", "Status"),
  });

  revalidateAdminPaths("/admin/businesses", `/admin/businesses/${businessId}`);
}

export async function updateAdminLocationProfileAction(formData: FormData) {
  const locationId = readRequiredFormString(formData, "location_id", "Location ID");

  await updatePlatformAdminLocationProfile({
    addressLine1: readFormString(formData, "address_line1"),
    addressLine2: readFormString(formData, "address_line2"),
    city: readFormString(formData, "city"),
    country: readRequiredFormString(formData, "country", "Country"),
    locationId,
    name: readRequiredFormString(formData, "name", "Location name"),
    phone: readFormString(formData, "phone"),
    postalCode: readFormString(formData, "postal_code"),
    reason: readReason(formData),
    state: readFormString(formData, "state"),
  });

  revalidateAdminPaths("/admin/locations", `/admin/locations/${locationId}`);
}

export async function updateAdminLocationStatusAction(formData: FormData) {
  const locationId = readRequiredFormString(formData, "location_id", "Location ID");

  await updatePlatformAdminLocationStatus({
    locationId,
    reason: readReason(formData),
    status: readRequiredFormString(formData, "status", "Status"),
  });

  revalidateAdminPaths("/admin/locations", `/admin/locations/${locationId}`);
}

export async function createAdminReportAction(formData: FormData) {
  const subjectType = readFormString(formData, "subject_type");
  const subjectId = readFormString(formData, "subject_id");
  const result = await createPlatformAdminReport({
    assignedMembershipId: readFormString(formData, "assigned_membership_id"),
    category: readRequiredFormString(formData, "category", "Category"),
    description: readFormString(formData, "description"),
    priority: readRequiredFormString(formData, "priority", "Priority"),
    reason: readFormString(formData, "reason"),
    reporterUserId: readFormString(formData, "reporter_user_id"),
    source: readFormString(formData, "source") ?? "manual",
    subjectBusinessId: subjectType === "business" ? subjectId : null,
    subjectLocationId: subjectType === "location" ? subjectId : null,
    subjectUserId: subjectType === "user" ? subjectId : null,
    summary: readRequiredFormString(formData, "summary", "Summary"),
  });

  revalidateAdminPaths("/admin/reports");
  redirect(`/admin/reports/${result.report_id}`);
}

export async function assignAdminReportAction(formData: FormData) {
  const reportId = readRequiredFormString(formData, "report_id", "Report ID");

  await assignPlatformAdminReport({
    assignedMembershipId: readFormString(formData, "assigned_membership_id"),
    reason: readReason(formData),
    reportId,
  });

  revalidateAdminPaths("/admin/reports", `/admin/reports/${reportId}`);
}

export async function updateAdminReportAction(formData: FormData) {
  const reportId = readRequiredFormString(formData, "report_id", "Report ID");

  await updatePlatformAdminReport({
    description: readFormString(formData, "description"),
    priority: readRequiredFormString(formData, "priority", "Priority"),
    reason: readReason(formData),
    reportId,
    status: readRequiredFormString(formData, "status", "Status"),
    summary: readRequiredFormString(formData, "summary", "Summary"),
  });

  revalidateAdminPaths("/admin/reports", `/admin/reports/${reportId}`);
}

export async function resolveAdminReportAction(formData: FormData) {
  const reportId = readRequiredFormString(formData, "report_id", "Report ID");

  await resolvePlatformAdminReport({
    reason: readReason(formData),
    reportId,
    resolution: readRequiredFormString(formData, "resolution", "Resolution"),
  });

  revalidateAdminPaths("/admin/reports", `/admin/reports/${reportId}`);
}

export async function closeAdminReportAction(formData: FormData) {
  const reportId = readRequiredFormString(formData, "report_id", "Report ID");

  await closePlatformAdminReport({
    reason: readReason(formData),
    reportId,
  });

  revalidateAdminPaths("/admin/reports", `/admin/reports/${reportId}`);
}

export async function createAdminNoteAction(formData: FormData) {
  const targetId = readRequiredFormString(formData, "target_id", "Note target ID");
  const targetType = readRequiredFormString(
    formData,
    "target_type",
    "Note target type",
  );
  const returnPath = readFormString(formData, "return_path") ?? "/admin";

  await createPlatformAdminNote({
    body: readRequiredFormString(formData, "body", "Note"),
    reason: readFormString(formData, "reason"),
    targetId,
    targetType: readNoteTargetType(targetType),
  });

  revalidateAdminPaths(returnPath);
}

export async function createAdminTeamMembershipAction(formData: FormData) {
  await createPlatformAdminMembership({
    reason: readReason(formData),
    roleSlug: readRequiredFormString(formData, "role_slug", "Role"),
    userId: readRequiredFormString(formData, "user_id", "User ID"),
  });

  revalidateAdminPaths("/admin/team");
}

export async function updateAdminTeamMembershipAction(formData: FormData) {
  await updatePlatformAdminMembership({
    membershipId: readRequiredFormString(formData, "membership_id", "Membership ID"),
    reason: readReason(formData),
    roleSlug: readRequiredFormString(formData, "role_slug", "Role"),
    status: readRequiredFormString(formData, "status", "Status"),
  });

  revalidateAdminPaths("/admin/team");
}
