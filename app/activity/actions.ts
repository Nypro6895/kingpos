"use server";

import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getSalonProfileHref } from "@/lib/salon-profile";
import { revalidatePath } from "next/cache";

type VisitExperienceResult =
  | {
      countsTowardReputation: boolean;
      error: null;
      feedbackState: "good" | "issue";
      salonId: string;
    }
  | { error: string };

function clean(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function recordVisitExperienceAction(input: {
  body?: string | null;
  feedbackState: "good" | "issue";
  ticketId: string;
}): Promise<VisitExperienceResult> {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return { error: "Experience could not be saved right now." };
  }

  const feedbackState =
    input.feedbackState === "issue" ? "issue" : "good";

  const { data, error } = await supabase.rpc(
    "record_customer_visit_experience",
    {
      p_body: clean(input.body) || null,
      p_feedback_state: feedbackState,
      p_ticket_id: input.ticketId,
    },
  );

  if (error) {
    if (
      error.code === "42883" ||
      error.message.includes("record_customer_visit_experience")
    ) {
      return {
        error: "Experience capture is ready in the app; the reputation backend still needs to be enabled.",
      };
    }

    return { error: error.message };
  }

  const payload = readObject(data);

  if (payload.ok !== true) {
    return {
      error:
        typeof payload.message === "string"
          ? payload.message
          : "Experience could not be saved.",
    };
  }

  const salonId = typeof payload.salonId === "string" ? payload.salonId : "";

  revalidatePath("/activity");
  revalidatePath(`/activity/receipts/${input.ticketId}`);
  revalidatePath("/explore");

  if (salonId) {
    revalidatePath(getSalonProfileHref(salonId));
  }

  return {
    countsTowardReputation: payload.countsTowardReputation === true,
    error: null,
    feedbackState,
    salonId,
  };
}
