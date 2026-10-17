"use server";

import { revalidatePath } from "next/cache";
import { marketPluginContext } from "@/lib/market-plugins";
import { bookingPolicySubscription } from "@/lib/booking-policy-subscription";
import { bookSmsState } from "@/lib/booksms";
import { saveBookingPolicy } from "@/app/market/booking-policy-actions";
import { saveBookSms } from "@/app/market/booksms-actions";
import { withSettingsTarget } from "@/lib/settings-target-context";

async function checkSalon(salonId: string) {
  const scope = await marketPluginContext();
  if (!salonId || scope.salonId !== salonId) throw new Error("Choose this salon in your Owner workspace first.");
  return scope;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Settings could not load."; }

export async function loadBookingRulesSettingsAction(salonId: string) {
  try { return await withSettingsTarget(salonId, async () => { await checkSalon(salonId); return { state: await bookingPolicySubscription(salonId) }; }); }
  catch (error) { return { error: errorMessage(error) }; }
}

export async function saveBookingRulesSettingsAction(salonId: string, content: string, published: boolean) {
  try {
    return await withSettingsTarget(salonId, async () => {
    await checkSalon(salonId);
    if (typeof published !== "boolean") throw new Error("Invalid booking rule settings.");
    const state = await bookingPolicySubscription(salonId);
    if ((!state.active && !state.subscribed) || (published && !state.active)) throw new Error("Activate Booking Rules in Market first.");
    const result = await saveBookingPolicy(content, published);
    if (result.error) return { error: result.error };
    revalidatePath("/settings");
    return { state: { ...state, content, published } };
    });
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function loadBookSmsSettingsAction(salonId: string) {
  try { return await withSettingsTarget(salonId, async () => { await checkSalon(salonId); return { state: await bookSmsState() }; }); }
  catch (error) { return { error: errorMessage(error) }; }
}

export async function saveBookSmsSettingsAction(salonId: string, options: { enabled: boolean; confirmation: boolean; reminders: boolean }) {
  try {
    return await withSettingsTarget(salonId, async () => {
    await checkSalon(salonId);
    if (!options || [options.enabled, options.confirmation, options.reminders].some(value => typeof value !== "boolean")) throw new Error("Invalid SMS settings.");
    const state = await bookSmsState();
    if (!state.installed || !state.active) throw new Error("Activate BookSMS in Market first.");
    // Preserve the saved sender and token; provider setup and installation stay in Market.
    const form = new FormData();
    form.set("installed", "on");
    for (const key of ["enabled", "confirmation", "reminders"] as const) if (options[key]) form.set(key, "on");
    for (const key of ["accountSid", "messagingServiceSid", "from"] as const) form.set(key, state[key]);
    return await saveBookSms(form);
    });
  } catch (error) { return { error: errorMessage(error) }; }
}
