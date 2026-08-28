import "server-only";

import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { createHash, randomBytes } from "crypto";
import { headers } from "next/headers";

export const OWNER_TRANSFER_INVITE_EXPIRY_DAYS = 14;

export type OwnerTransferMode = "add_co_owner" | "transfer_ownership";

export type OwnerTransferInviteResult = {
  account_id: string;
  expires_at: string;
  id: string;
  invite_url: string | null;
  mode: OwnerTransferMode;
  salon_id: string;
  status: "pending";
  target_email_normalized: string;
};

export type OwnerTransferAcceptanceResult = {
  accepted_by_user_id: string;
  account_id: string;
  id: string;
  mode: OwnerTransferMode;
  relinquished_inviter: boolean;
  salon_id: string;
  status: "accepted";
};

function generateOwnerTransferToken() {
  return randomBytes(32).toString("base64url");
}

function hashOwnerTransferToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function cleanOrigin(value: string | null | undefined) {
  return value?.trim().replace(/\/+$/, "") || null;
}

async function getAppOrigin() {
  const configuredOrigin =
    cleanOrigin(process.env.NEXT_PUBLIC_APP_URL) ?? cleanOrigin(process.env.APP_URL);

  if (configuredOrigin) {
    return configuredOrigin;
  }

  const headerStore = await headers();
  const host =
    headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? null;

  if (!host) {
    return null;
  }

  const protocol =
    headerStore.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${protocol}://${host}`;
}

async function getOwnerTransferInviteUrl(token: string) {
  const origin = await getAppOrigin();

  if (!origin) {
    return null;
  }

  return `${origin}/ownership/invite/${encodeURIComponent(token)}`;
}

async function requireOwnerTransferAuth() {
  const [supabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
  ]);

  if (!supabase || !user) {
    throw new Error("Sign in before managing owner transfer.");
  }

  return { supabase, user };
}

export async function createOwnerTransferInvite(input: {
  message?: string | null;
  mode: OwnerTransferMode;
  recipientEmail: string;
  relinquishOnAccept?: boolean;
  salonId: string;
}): Promise<OwnerTransferInviteResult> {
  const { supabase } = await requireOwnerTransferAuth();
  const token = generateOwnerTransferToken();
  const tokenHash = hashOwnerTransferToken(token);
  const expiresAt = new Date(
    Date.now() + OWNER_TRANSFER_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase.rpc(
    "create_salon_owner_transfer_invite",
    {
      p_expires_at: expiresAt,
      p_message: input.message ?? null,
      p_mode: input.mode,
      p_recipient_email: input.recipientEmail,
      p_relinquish_on_accept: input.relinquishOnAccept ?? false,
      p_salon_id: input.salonId,
      p_token_hash: tokenHash,
    },
  );

  if (error) {
    console.error("Supabase owner transfer invite create failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: input.salonId,
    });
    throw new Error(error.message);
  }

  return {
    ...(data as Omit<OwnerTransferInviteResult, "invite_url">),
    invite_url: await getOwnerTransferInviteUrl(token),
  };
}

export async function acceptOwnerTransferInvite(token: string) {
  const { supabase } = await requireOwnerTransferAuth();
  const cleanedToken = token.trim();

  if (!cleanedToken) {
    throw new Error("Owner invitation token is required.");
  }

  const { data, error } = await supabase.rpc(
    "accept_salon_owner_transfer_invite",
    {
      p_token_hash: hashOwnerTransferToken(cleanedToken),
    },
  );

  if (error) {
    console.error("Supabase owner transfer invite accept failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    throw new Error(error.message);
  }

  return data as OwnerTransferAcceptanceResult;
}

export async function acceptOwnerTransferInviteById(inviteId: string) {
  const { supabase } = await requireOwnerTransferAuth();
  const { data, error } = await supabase.rpc(
    "accept_salon_owner_transfer_invite_by_id",
    {
      p_invite_id: inviteId,
    },
  );

  if (error) {
    console.error("Supabase owner transfer invite id accept failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      inviteId,
    });
    throw new Error(error.message);
  }

  return data as OwnerTransferAcceptanceResult;
}

export async function relinquishSalonOwnership(input: {
  reason?: string | null;
  salonId: string;
}) {
  const { supabase } = await requireOwnerTransferAuth();
  const { data, error } = await supabase.rpc(
    "relinquish_current_salon_ownership",
    {
      p_reason: input.reason ?? null,
      p_salon_id: input.salonId,
    },
  );

  if (error) {
    console.error("Supabase relinquish salon ownership failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: input.salonId,
    });
    throw new Error(error.message);
  }

  return data;
}

export async function revokeOwnerTransferInvite(inviteId: string) {
  const { supabase } = await requireOwnerTransferAuth();
  const { data, error } = await supabase.rpc(
    "revoke_salon_owner_transfer_invite",
    {
      p_invite_id: inviteId,
    },
  );

  if (error) {
    console.error("Supabase owner transfer invite revoke failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      inviteId,
      message: error.message,
    });
    throw new Error(error.message);
  }

  return data;
}
