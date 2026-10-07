"use server";

import { relinquishSalonOwnership } from "@/lib/owner-transfer";
import { clearWorkspaceContextCookies } from "@/lib/current-context";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function leaveSalonOwnershipAction(salonId: string) {
  try {
    await relinquishSalonOwnership({ salonId, reason: "Owner voluntarily left salon ownership." });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not leave ownership." };
  }
  clearWorkspaceContextCookies(await cookies());
  revalidatePath("/", "layout");
  redirect("/my-place");
}
