import { createSupabaseServerClient, getSupabaseAuthUser } from "@/lib/supabase/server";
import type { KingUser } from "@/types/user";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";

const USER_SELECT =
  "id, auth_user_id, email, phone, first_name, last_name, display_name, avatar_url, status, language, timezone, last_login_at, created_at, updated_at";

function readMetadataString(metadata: SupabaseAuthUser["user_metadata"], key: string) {
  const value = metadata[key];

  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue || null;
}

async function createMissingKingUser(authUser: SupabaseAuthUser) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const displayName =
    readMetadataString(authUser.user_metadata, "display_name") ??
    readMetadataString(authUser.user_metadata, "full_name") ??
    readMetadataString(authUser.user_metadata, "name") ??
    authUser.email ??
    null;

  const { data, error } = await supabase
    .from("users")
    .insert({
      auth_user_id: authUser.id,
      email: authUser.email ?? null,
      phone: authUser.phone ?? null,
      first_name: readMetadataString(authUser.user_metadata, "first_name"),
      last_name: readMetadataString(authUser.user_metadata, "last_name"),
      display_name: displayName,
      avatar_url:
        readMetadataString(authUser.user_metadata, "avatar_url") ??
        readMetadataString(authUser.user_metadata, "picture"),
      status: "active",
    })
    .select(USER_SELECT)
    .maybeSingle<KingUser>();

  if (!error) {
    console.log("Created missing public.users record for auth user", {
      authUserId: authUser.id,
      kingUserId: data?.id,
    });
    return data;
  }

  console.error("Unable to create missing public.users record", {
    authUserId: authUser.id,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });

  const { data: existingUser, error: existingUserError } = await supabase
    .from("users")
    .select(USER_SELECT)
    .eq("auth_user_id", authUser.id)
    .maybeSingle<KingUser>();

  if (existingUserError) {
    console.error("Unable to reload public.users record after create failure", {
      authUserId: authUser.id,
      code: existingUserError.code,
      message: existingUserError.message,
      details: existingUserError.details,
      hint: existingUserError.hint,
    });
    return null;
  }

  return existingUser;
}

export async function getCurrentKingUser() {
  const supabase = createSupabaseServerClient();
  const authUser = await getSupabaseAuthUser();

  if (!supabase || !authUser) {
    return null;
  }

  const { data, error } = await supabase
    .from("users")
    .select(USER_SELECT)
    .eq("auth_user_id", authUser.id)
    .maybeSingle<KingUser>();

  if (error) {
    console.error("Unable to load public.users record for auth user", {
      authUserId: authUser.id,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return null;
  }

  if (!data) {
    console.log("No public.users record found for auth user; creating fallback record", {
      authUserId: authUser.id,
    });
  }

  return data ?? createMissingKingUser(authUser);
}
