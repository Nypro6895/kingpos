"use server";

import {
  getCurrentAppNotification,
  markAppNotificationRead,
  markAppNotificationsRead,
} from "@/lib/app-notifications";
import {
  getCurrentBusinessContext,
  setNormalizedWorkspaceContext,
} from "@/lib/current-context";
import { resolveAppNotificationDestination } from "@/lib/notification-feed-items";
import { getAppNotificationScopeForContext } from "@/lib/workspace-pending";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function revalidateAppNotificationSurfaces() {
  revalidatePath("/notifications");
}

function safeNotificationHref(href: string) {
  return href.startsWith("/") && !href.startsWith("//")
    ? href
    : "/notifications";
}

function redirectOpenNotificationError(message: string): never {
  redirect(`/my-place?error=${encodeURIComponent(message)}`);
}

async function applyNotificationWorkspaceContext(input: {
  destinationHref: string;
  notificationId: string;
  workspaceId: string | null;
}) {
  if (!input.workspaceId) {
    return;
  }

  const context = await getCurrentBusinessContext();

  if (!context.user) {
    redirect(`/login?next=${encodeURIComponent(input.destinationHref)}`);
  }

  const workspace = context.workspaceOptions.find(
    (option) =>
      option.id === input.workspaceId &&
      option.type === "salon" &&
      (option.salonMode === "manage" || option.salonMode === "staff"),
  );

  if (!workspace) {
    console.error("Blocked notification workspace switch", {
      notificationId: input.notificationId,
      workspaceId: input.workspaceId,
    });
    redirectOpenNotificationError(
      "Choose a valid salon workspace before opening that notification.",
    );
  }

  try {
    await setNormalizedWorkspaceContext(workspace);
  } catch (error) {
    console.error("Notification workspace context could not be updated", {
      message: error instanceof Error ? error.message : "Unknown error",
      notificationId: input.notificationId,
      workspaceId: input.workspaceId,
    });
    redirectOpenNotificationError(
      "Choose a valid salon workspace before opening that notification.",
    );
  }

  revalidatePath("/", "layout");
}

export async function openAppNotificationAction(formData: FormData) {
  const notificationId = readString(formData, "notification_id");
  const submittedHref = safeNotificationHref(
    readString(formData, "href") || "/notifications",
  );
  const notification = notificationId
    ? await getCurrentAppNotification(notificationId)
    : null;
  const destination = notification
    ? resolveAppNotificationDestination(notification)
    : {
        href: submittedHref,
        label: "Open",
        workspaceId: null,
      };

  await applyNotificationWorkspaceContext({
    destinationHref: destination.href,
    notificationId,
    workspaceId: destination.workspaceId,
  });

  if (notificationId) {
    const didMarkRead = await markAppNotificationRead(notificationId);

    if (didMarkRead) {
      revalidateAppNotificationSurfaces();
    }
  }

  redirect(destination.href);
}

export async function markAppNotificationReadAction(formData: FormData) {
  const notificationId = readString(formData, "notification_id");

  if (notificationId) {
    const didMarkRead = await markAppNotificationRead(notificationId);

    if (didMarkRead) {
      revalidateAppNotificationSurfaces();
    }
  }
}

export async function markAllAppNotificationsReadAction() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return;
  }

  const didMarkRead = await markAppNotificationsRead(
    getAppNotificationScopeForContext(context),
  );

  if (didMarkRead) {
    revalidateAppNotificationSurfaces();
  }
}

export async function runNotificationBookingAction(input: {
  notificationId: string;
  command: "confirm" | "cancel";
  expectedUpdatedAt: string;
  acknowledgeNoShow?: boolean;
}) {
  const notification = await getCurrentAppNotification(input.notificationId);
  if (!notification?.booking_id)
    return { ok: false, message: "Appointment not found." };
  const destination = resolveAppNotificationDestination(notification);
  await applyNotificationWorkspaceContext({
    destinationHref: destination.href,
    notificationId: notification.id,
    workspaceId: destination.workspaceId,
  });
  if (notification.recipient_kind === "staff") {
    if (input.command !== "confirm")
      return { ok: false, message: "Open the appointment to manage changes." };
    const { confirmStaffBookingWithReviewAction } =
      await import("@/app/staff/appointments/actions");
    return confirmStaffBookingWithReviewAction({
      bookingId: notification.booking_id,
      acknowledgeNoShow: input.acknowledgeNoShow,
    });
  }
  if (notification.recipient_kind !== "owner_manager")
    return { ok: false, message: "Open the appointment to manage changes." };
  const { saveOwnerWorkspaceBookingAction } =
    await import("@/app/bookings/actions");
  const result = await saveOwnerWorkspaceBookingAction({
    bookingId: notification.booking_id,
    expectedUpdatedAt: input.expectedUpdatedAt,
    command: input.command,
    acknowledgeNoShow: input.acknowledgeNoShow,
  });
  if (result.ok) revalidateAppNotificationSurfaces();
  return result;
}
