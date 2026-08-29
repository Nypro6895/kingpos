"use server";

import { respondToBeautySalonPublicationRequest } from "@/lib/beauty-salon-publications";
import { getSalonProfileHref } from "@/lib/salon-profile";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function redirectWithMessage(type: "error" | "notice", message: string): never {
  redirect(
    `/salon-profile/client-transformations?${type}=${encodeURIComponent(
      message,
    )}`,
  );
}

function revalidateBeautySalonPublicationPaths(salonId: string) {
  revalidatePath("/", "layout");
  revalidatePath("/notifications");
  revalidatePath("/salon-profile");
  revalidatePath("/salon-profile/client-transformations");
  revalidatePath("/explore");
  revalidatePath(getSalonProfileHref(salonId));
}

function safeTransformationActionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const safeMessages = new Set([
    "Beauty transformation request was not found.",
    "Choose a Beauty transformation request.",
    "Open a salon management workspace to review transformations.",
    "Sign in before reviewing Beauty transformations.",
    "You do not have permission to review this request.",
  ]);

  if (safeMessages.has(message)) {
    return message;
  }

  if (message.startsWith("Missing required permission:")) {
    return "You do not have permission to review this request.";
  }

  console.error("Beauty salon publication action failed", {
    message: message || "Unknown error",
  });

  return "Could not update this transformation. Please try again.";
}

async function respond(formData: FormData, response: "approved" | "declined") {
  const publicationId = readString(formData, "publication_id");
  let result: Awaited<
    ReturnType<typeof respondToBeautySalonPublicationRequest>
  >;

  try {
    result = await respondToBeautySalonPublicationRequest({
      publicationId,
      response,
    });
  } catch (error) {
    redirectWithMessage(
      "error",
      safeTransformationActionErrorMessage(error),
    );
  }

  revalidateBeautySalonPublicationPaths(result.salonId);
  redirectWithMessage(
    "notice",
    result.status === "approved"
      ? "Added to your salon profile."
      : "This transformation will stay on the customer's Beauty profile only.",
  );
}

export async function acceptBeautySalonPublicationRequestAction(
  formData: FormData,
) {
  await respond(formData, "approved");
}

export async function declineBeautySalonPublicationRequestAction(
  formData: FormData,
) {
  await respond(formData, "declined");
}
