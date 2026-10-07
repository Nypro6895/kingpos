"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { SALON_SETTING_PERMISSIONS } from "@/lib/salon-settings";
import { getPublicSalonOperatingHours, getCurrentSalonOperatingHoursSettings, updateCurrentSalonOperatingHours } from "@/lib/salon-operating-status";
import type { UpdateSalonOperatingHoursInput } from "@/types/salon-operating-status";

async function currentSalon(salonId:string) {
  const context=await getCurrentBusinessContext();
  if(!context.user || context.currentSalon?.id!==salonId) throw new Error("Open this profile from its salon workspace.");
  return context;
}
export async function loadProfileOperatingHours(salonId:string) {
  try {
    const context=await currentSalon(salonId);
    const [settings,canManage]=await Promise.all([getCurrentSalonOperatingHoursSettings(context),hasPermission(SALON_SETTING_PERMISSIONS.manage,context)]);
    return {settings,canManage,error:null};
  } catch(error) {return {settings:null,canManage:false,error:error instanceof Error?error.message:"Could not load hours."};}
}
export async function loadVisibleProfileHours(salonId: string) {
  try {
    const settings = await getPublicSalonOperatingHours(salonId);
    if (settings) return { settings, error: null };
    const context = await currentSalon(salonId);
    return { settings: await getCurrentSalonOperatingHoursSettings(context), error: null };
  } catch { return { settings: null, error: "Could not load operating hours. Please try again." }; }
}
export async function saveProfileOperatingHours(salonId:string,input:UpdateSalonOperatingHoursInput) {
  try {
    const context=await currentSalon(salonId);
    if(!await hasPermission(SALON_SETTING_PERMISSIONS.manage,context))throw new Error("You do not have permission to change salon hours.");
    await updateCurrentSalonOperatingHours(input);
    revalidatePath("/salon-settings");revalidatePath("/salon-profile");revalidatePath("/explore");revalidatePath(`/explore/salons/${salonId}`);
    return {ok:true,error:null};
  } catch(error) {return {ok:false,error:error instanceof Error?error.message:"Could not save hours."};}
}
