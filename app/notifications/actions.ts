"use server";

import { markAppNotificationRead } from "@/lib/app-notifications";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function openAppNotificationAction(formData: FormData) {
  const notificationId = readString(formData, "notification_id");
  const href = readString(formData, "href") || "/notifications";

  if (notificationId) {
    await markAppNotificationRead(notificationId);
    revalidatePath("/notifications");
  }

  redirect(href.startsWith("/") ? href : "/notifications");
}

export async function markAppNotificationReadAction(formData: FormData) {
  const notificationId = readString(formData, "notification_id");

  if (notificationId) {
    await markAppNotificationRead(notificationId);
    revalidatePath("/notifications");
  }
}
