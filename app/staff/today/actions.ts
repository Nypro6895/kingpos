"use server";

import {
  addTodayQuickAccess,
  moveTodayQuickAccess,
  removeTodayQuickAccess,
  saveTodayQuickAccesses,
} from "@/lib/today-quick-accesses";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { revalidatePath } from "next/cache";

function readShortcutId(formData: FormData) {
  const shortcutId = formData.get("shortcutId");

  if (typeof shortcutId !== "string" || !shortcutId.trim()) {
    throw new Error("Missing shortcut.");
  }

  return shortcutId.trim();
}

function readShortcutIds(formData: FormData) {
  const shortcutIds = formData.getAll("shortcutIds");

  return shortcutIds.map((shortcutId) => {
    if (typeof shortcutId !== "string" || !shortcutId.trim()) {
      throw new Error("Invalid shortcut.");
    }

    return shortcutId.trim();
  });
}

export async function addTodayQuickAccessAction(formData: FormData) {
  const context = await requireSalonManagePageContext("/staff/today");

  await addTodayQuickAccess(context, readShortcutId(formData));
  revalidatePath("/staff/today");
}

export async function removeTodayQuickAccessAction(formData: FormData) {
  const context = await requireSalonManagePageContext("/staff/today");

  await removeTodayQuickAccess(context, readShortcutId(formData));
  revalidatePath("/staff/today");
}

export async function moveTodayQuickAccessAction(formData: FormData) {
  const direction = formData.get("direction");
  const context = await requireSalonManagePageContext("/staff/today");

  if (direction !== "up" && direction !== "down") {
    throw new Error("Invalid shortcut order.");
  }

  await moveTodayQuickAccess(context, readShortcutId(formData), direction);
  revalidatePath("/staff/today");
}

export async function saveTodayQuickAccessesAction(formData: FormData) {
  const context = await requireSalonManagePageContext("/staff/today");

  await saveTodayQuickAccesses(context, readShortcutIds(formData));
  revalidatePath("/staff/today");
}
