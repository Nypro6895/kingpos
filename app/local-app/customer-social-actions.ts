"use server";

import { revalidatePath } from "next/cache";
import { removeAccountBeautyProfileFollow, removeAccountFavoriteShop, removeAccountSavedPost } from "@/lib/account-social";
import type { AccountSavedPostSourceType } from "@/types/saved-post";

const text = (form: FormData, name: string) => { const value = form.get(name); return typeof value === "string" ? value.trim() : ""; };
/** Same account-authorized action as the shipped saved-post page. */
export async function removeAppLocalSavedPostAction(form: FormData) {
  const sourceType = text(form, "source_type") as AccountSavedPostSourceType | "", sourceId = text(form, "source_id"), salonId = text(form, "salon_id");
  if (sourceType && sourceId) {
    await removeAccountSavedPost({ salonId, sourceId, sourceType });
    revalidatePath("/more/saved-post"); revalidatePath("/more/saved-designs");
  }
}
/** Same shop/Beauty owner checks as the shipped Following page. */
export async function removeAppLocalFollowingAction(form: FormData) {
  const targetType = text(form, "target_type"), targetId = text(form, "target_id");
  if (targetType === "shop" && targetId) {
    await removeAccountFavoriteShop(targetId); revalidatePath("/more/favorite-shop"); revalidatePath("/more/following"); revalidatePath(`/explore/salons/${targetId}`);
  }
  if (targetType === "beauty" && targetId) {
    await removeAccountBeautyProfileFollow(targetId); revalidatePath("/more/favorite-customer"); revalidatePath("/more/following"); revalidatePath(`/explore/beauty/${targetId}`);
  }
}
