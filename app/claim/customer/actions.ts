"use server";

import { claimCustomerFromToken } from "@/lib/customer-identity-claims";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function readToken(formData: FormData) {
  const value = formData.get("token");
  return typeof value === "string" ? value.trim() : "";
}

function statusForError(code: string) {
  if (code === "expired_token") {
    return "expired";
  }

  if (code === "token_used") {
    return "used";
  }

  if (code === "customer_unavailable" || code === "phone_conflict") {
    return "conflict";
  }

  if (code === "invalid_token" || code === "invalid_phone") {
    return "invalid";
  }

  return "error";
}

export async function connectCustomerHistory(formData: FormData) {
  const token = readToken(formData);
  const result = await claimCustomerFromToken(token);

  if (result.ok) {
    revalidatePath("/activity");
    redirect(
      `/claim/customer?status=${
        result.data.idempotent ? "already_connected" : "connected"
      }`,
    );
  }

  if (result.code === "sign_in_required") {
    redirect(
      `/login?next=${encodeURIComponent(
        token ? `/claim/customer?token=${encodeURIComponent(token)}` : "/claim/customer",
      )}`,
    );
  }

  redirect(`/claim/customer?status=${statusForError(result.code)}`);
}
