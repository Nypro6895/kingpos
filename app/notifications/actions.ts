"use server";

import {
  markAppNotificationRead,
  markAppNotificationsRead,
} from "@/lib/app-notifications";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { getAppNotificationScopeForContext } from "@/lib/workspace-pending";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function revalidateAppNotificationSurfaces() {
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function openAppNotificationAction(formData: FormData) {
  const notificationId = readString(formData, "notification_id");
  const href = readString(formData, "href") || "/notifications";

  if (notificationId) {
    const didMarkRead = await markAppNotificationRead(notificationId);

    if (didMarkRead) {
      revalidateAppNotificationSurfaces();
    }
  }

  redirect(href.startsWith("/") ? href : "/notifications");
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
