import {
  createSupabaseServerClient,
  createUserScopedSupabaseServerClient,
  getAccessTokenFromRequest,
  getSupabaseAuthUser,
} from "@/lib/supabase/server";
import { isDeniedKingUserStatus } from "@/lib/users/account-status";
import type { KingUser } from "@/types/user";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";

const USER_SELECT =
  "id, auth_user_id, email, phone, first_name, last_name, display_name, avatar_url, status, language, timezone, deletion_requested_at, deletion_scheduled_for, deleted_at, anonymized_at, deletion_finalization_started_at, deletion_finalized_at, deletion_finalization_attempts, deletion_finalization_failed_at, deletion_finalization_error, last_login_at, created_at, updated_at";

function readMetadataString(metadata: SupabaseAuthUser["user_metadata"], key: string) {
  const value = metadata[key];

  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue || null;
}

async function createMissingKingUser(
  authUser: SupabaseAuthUser,
  accessToken?: string | null,
) {
  const supabase = accessToken
    ? createUserScopedSupabaseServerClient(accessToken)
    : createSupabaseServerClient();

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

  if (error.code === "23505") {
    console.log("Missing public.users record was created concurrently", {
      authUserId: authUser.id,
    });
  } else {
    console.error("Unable to create missing public.users record", {
      authUserId: authUser.id,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
  }

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

async function authIdentityWasFinalized(
  supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>,
  authUser: SupabaseAuthUser,
) {
  const { data, error } = await supabase.rpc("auth_identity_is_deleted", {
    p_auth_user_id: authUser.id,
  });

  if (error) {
    if (error.code !== "42883" && error.code !== "42P01") {
      console.error("Unable to check deleted auth identity tombstone", {
        authUserId: authUser.id,
        code: error.code,
        details: error.details,
        hint: error.hint,
        message: error.message,
      });
    }

    return false;
  }

  return data === true;
}

export async function getKingUserForAuthUser(
  authUser: SupabaseAuthUser,
  accessToken?: string | null,
) {
  const supabase = accessToken
    ? createUserScopedSupabaseServerClient(accessToken)
    : createSupabaseServerClient();

  if (!supabase) {
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

  if (!data && (await authIdentityWasFinalized(supabase, authUser))) {
    console.log("Deleted auth identity tombstone blocked public user fallback", {
      authUserId: authUser.id,
    });
    return null;
  }

  if (!data) {
    console.log("No public.users record found for auth user; creating fallback record", {
      authUserId: authUser.id,
    });
  }

  return data ?? createMissingKingUser(authUser, accessToken);
}

export async function getCurrentKingUser() {
  const [authUser, accessToken] = await Promise.all([
    getSupabaseAuthUser(),
    getAccessTokenFromRequest(),
  ]);

  if (!authUser) {
    return null;
  }

  const user = await getKingUserForAuthUser(authUser, accessToken);

  if (!user || isDeniedKingUserStatus(user.status)) {
    return null;
  }

  return user;
}
