"use server";

import {
  ACCOUNT_AVATAR_BUCKET,
  buildAccountAvatarPath,
  getAccountAvatarPublicUrl,
  safeAccountAvatarUrl,
} from "@/lib/account-avatar";
import {
  createAuthenticatedSupabaseServerClient,
  getAccessTokenFromRequest,
  getSupabaseConfig,
} from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { revalidatePath } from "next/cache";

type ActionInput = FormData | Record<string, unknown>;

export type AccountAvatarUploadSession = {
  accessToken: string;
  anonKey: string;
  bucket: string;
  path: string;
  publicUrl: string;
  supabaseUrl: string;
};

export type AccountProfileActionResult = {
  error: string | null;
};

function actionHasKey(input: ActionInput, key: string) {
  return input instanceof FormData ? input.has(key) : key in input;
}

function readActionValue(input: ActionInput, key: string) {
  return input instanceof FormData ? input.get(key) : input[key];
}

function readActionString(input: ActionInput, key: string) {
  const value = readActionValue(input, key);

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function readActionOptionalString(input: ActionInput, key: string) {
  return readActionString(input, key) || null;
}

function readActionBoolean(input: ActionInput, key: string) {
  const value = readActionValue(input, key);

  if (typeof value === "boolean") {
    return value;
  }

  return value === "on" || value === "true";
}

export async function getAccountAvatarUploadSessionAction(): Promise<AccountAvatarUploadSession> {
  const [accessToken, user] = await Promise.all([
    getAccessTokenFromRequest(),
    getCurrentKingUser(),
  ]);
  const config = getSupabaseConfig();

  if (!config || !accessToken || !user) {
    throw new Error("Sign in before uploading an avatar.");
  }

  const path = buildAccountAvatarPath(user.id);

  return {
    accessToken,
    anonKey: config.supabaseAnonKey,
    bucket: ACCOUNT_AVATAR_BUCKET,
    path,
    publicUrl: getAccountAvatarPublicUrl({
      bucket: ACCOUNT_AVATAR_BUCKET,
      path,
      supabaseUrl: config.supabaseUrl,
    }),
    supabaseUrl: config.supabaseUrl,
  };
}

export async function updateAccountProfileAction(
  input: ActionInput,
): Promise<AccountProfileActionResult> {
  const [supabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
  ]);

  if (!supabase || !user) {
    return { error: "Sign in before updating your account." };
  }

  const patch: Record<string, string | null> = {
    display_name: readActionOptionalString(input, "display_name"),
    first_name: readActionOptionalString(input, "first_name"),
    last_name: readActionOptionalString(input, "last_name"),
    language: readActionOptionalString(input, "language") ?? "en",
    phone: readActionOptionalString(input, "phone"),
    timezone: readActionOptionalString(input, "timezone") ?? "America/Chicago",
  };

  if (readActionBoolean(input, "remove_avatar")) {
    patch.avatar_url = null;
  } else if (actionHasKey(input, "avatar_url")) {
    const avatarUrl = readActionOptionalString(input, "avatar_url");

    if (avatarUrl && !safeAccountAvatarUrl(avatarUrl)) {
      return { error: "Avatar URL is not valid." };
    }

    patch.avatar_url = avatarUrl;
  }

  const { error } = await supabase
    .from("users")
    .update(patch)
    .eq("id", user.id);

  if (error) {
    console.error("Supabase update account profile failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      userId: user.id,
    });

    return { error: "Unable to update profile." };
  }

  revalidatePath("/account");
  revalidatePath("/beauty");
  revalidatePath("/", "layout");

  return { error: null };
}
