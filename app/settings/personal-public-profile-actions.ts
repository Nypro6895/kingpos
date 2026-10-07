"use server";
import { getSelfBeautyProfileSettings } from "@/lib/beauty";
export async function loadPersonalPublicProfileSettings() {
  return getSelfBeautyProfileSettings();
}
