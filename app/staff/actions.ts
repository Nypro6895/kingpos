"use server";

import { createStaff as createStaffRecord } from "@/lib/staff";
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
  redirect(`/staff?error=${encodeURIComponent(message)}`);
}

export async function createStaff(formData: FormData) {
  const displayName = readRequiredString(formData, "display_name");

  if (!displayName) {
    redirectWithError("Display Name is required.");
  }

  try {
    await createStaffRecord({
      display_name: displayName,
      first_name: readOptionalString(formData, "first_name"),
      last_name: readOptionalString(formData, "last_name"),
      phone: readOptionalString(formData, "phone"),
      email: readOptionalString(formData, "email"),
      job_title: readOptionalString(formData, "job_title"),
      is_active: formData.get("is_active") === "on",
    });
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Staff could not be created.");
  }

  revalidatePath("/staff");
  redirect("/staff");
}
