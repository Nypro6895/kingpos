"use server";
import { revalidatePath } from "next/cache";
import { marketPluginContext } from "@/lib/market-plugins";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { bookingPolicyPayment } from "@/lib/booking-policy-subscription";
export async function saveBookingPolicy(content: string, published: boolean) {
  try {
    if (typeof content !== "string" || content.trim().length > 6000 || (published && !content.trim())) throw new Error("Enter booking rules (up to 6000 characters).");
    const { client, salonId } = await marketPluginContext();
    const { error } = await client.rpc("booking_policy_save", { p_salon: salonId, p_content: content, p_published: published === true });
    if (error) throw new Error("Booking rules could not be saved. Please try again.");
    revalidatePath("/market"); revalidatePath(`/book/${salonId}`);
    return { saved: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not save booking rules." }; }
}
export async function bookingPolicyPaymentAction(portal: boolean) {
  try {
    const { salonId } = await marketPluginContext();
    const context = await getCurrentBusinessContext();
    if (!context.user) throw new Error("Please sign in again.");
    return { url: await bookingPolicyPayment(salonId, context.user.id, portal === true) };
  } catch (error) { return { error: error instanceof Error ? error.message : "Checkout could not open." }; }
}
