"use server";

import {
  getCurrentBusinessContext,
  isOwnerMembership,
  setCurrentSalonCookie,
} from "@/lib/current-context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function redirectWithError(message: string): never {
  redirect(`/salons?error=${encodeURIComponent(message)}`);
}

export async function setCurrentSalon(formData: FormData) {
  const salonId = formData.get("salon_id");

  if (typeof salonId !== "string" || !salonId.trim()) {
    redirectWithError("Choose a Salon before setting the current Salon.");
  }

  const context = await getCurrentBusinessContext();

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentOrganization || !context.currentMembership) {
    redirectWithError("Create an organization before choosing a current Salon.");
  }

  if (!isOwnerMembership(context.currentMembership)) {
    redirectWithError("Only an Owner can switch the current Salon.");
  }

  const allowedSalon = context.salons.find((salon) => salon.id === salonId.trim());

  if (!allowedSalon) {
    console.error("Blocked current Salon switch outside current organization", {
      requestedSalonId: salonId,
      organizationId: context.currentOrganization.id,
      userId: context.user.id,
    });
    redirectWithError("You can only switch to a Salon in your organization.");
  }

  await setCurrentSalonCookie(allowedSalon.id);
  revalidatePath("/", "layout");
  redirect("/salons");
}
