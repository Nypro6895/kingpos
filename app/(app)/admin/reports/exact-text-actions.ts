"use server";

import { loadExactTextModeration, setExactTextVisibility } from "@/lib/platform-admin/exact-text-moderation";
import type { ExactTextVisibilityInput } from "@/types/admin-exact-text-moderation";

export async function loadExactTextModerationAction(reportId: string) {
  return loadExactTextModeration(reportId);
}
export async function setExactTextVisibilityAction(input: ExactTextVisibilityInput) {
  return setExactTextVisibility(input);
}
