"use server";

import { createService as createServiceRecord } from "@/lib/services";
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

function readNumber(formData: FormData, key: string) {
  const value = readRequiredString(formData, key);
  return Number(value);
}

function redirectWithError(message: string): never {
  redirect(`/services?error=${encodeURIComponent(message)}`);
}

export async function createService(formData: FormData) {
  const name = readRequiredString(formData, "name");
  const basePrice = readNumber(formData, "base_price");
  const durationMinutes = readNumber(formData, "duration_minutes");

  if (!name) {
    redirectWithError("Name is required.");
  }

  if (!Number.isFinite(basePrice) || basePrice < 0) {
    redirectWithError("Base Price must be greater than or equal to 0.");
  }

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    redirectWithError("Duration must be greater than 0.");
  }

  try {
    await createServiceRecord({
      name,
      category: readOptionalString(formData, "category"),
      base_price: basePrice,
      duration_minutes: durationMinutes,
      description: readOptionalString(formData, "description"),
      is_active: formData.get("is_active") === "on",
    });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Service could not be created.",
    );
  }

  revalidatePath("/services");
  redirect("/services");
}
