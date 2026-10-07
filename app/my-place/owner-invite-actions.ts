"use server";

import { acceptOwnerTransferInviteById, ignoreOwnerTransferInvite } from "@/lib/owner-transfer";
import { revalidatePath } from "next/cache";

export async function respondOwnerInvite(id: string, response: "accept" | "ignore") {
  try {
    if (response === "accept") await acceptOwnerTransferInviteById(id);
    else if (response === "ignore") await ignoreOwnerTransferInvite(id);
    else throw new Error("Invalid invitation response.");
    revalidatePath("/", "layout");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not respond to invitation." };
  }
}
