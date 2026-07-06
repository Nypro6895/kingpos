"use server";

import { updateCurrentSalonSetting } from "@/lib/salon-settings";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function readRequiredString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function readOptionalString(formData: FormData, key: string) {
  const value = readRequiredString(formData, key);
  return value || null;
}

function redirectWithError(message: string): never {
  redirect(`/salon-settings?error=${encodeURIComponent(message)}`);
}

export async function updateSalonSettings(formData: FormData) {
  const businessName = readRequiredString(formData, "business_name");

  if (!businessName) {
    redirectWithError("Business Name is required.");
  }

  try {
    await updateCurrentSalonSetting({
      business_name: businessName,
      phone: readOptionalString(formData, "phone"),
      email: readOptionalString(formData, "email"),
      website: readOptionalString(formData, "website"),
      address_line1: readOptionalString(formData, "address_line1"),
      address_line2: readOptionalString(formData, "address_line2"),
      city: readOptionalString(formData, "city"),
      state: readOptionalString(formData, "state"),
      postal_code: readOptionalString(formData, "postal_code"),
      country: readOptionalString(formData, "country"),
      business_description: readOptionalString(formData, "business_description"),
    });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Salon settings could not be saved.",
    );
  }

  revalidatePath("/salon-settings");
  redirect("/salon-settings");
}
