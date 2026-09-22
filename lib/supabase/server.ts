import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import {
  ACCOUNT_LOGIN_SESSION_COOKIE,
  isAccountLoginSessionId,
} from "@/lib/account-security-shared";
import { isDeniedKingUserStatus } from "@/lib/users/account-status";
import type { KingUserStatus } from "@/types/user";
import { cookies, headers } from "next/headers";

export const ACCESS_TOKEN_COOKIE = "sb-access-token";
export const REFRESH_TOKEN_COOKIE = "sb-refresh-token";
export const PENDING_MFA_ACCESS_TOKEN_COOKIE = "sb-pending-mfa-access-token";
export const PENDING_MFA_REFRESH_TOKEN_COOKIE = "sb-pending-mfa-refresh-token";
export const PENDING_MFA_REMEMBER_COOKIE = "sb-pending-mfa-remember";

const PENDING_MFA_MAX_AGE_SECONDS = 60 * 10;

type SupabaseSessionTokens = {
  accessToken: string;
  refreshToken: string;
};

type PendingMfaSessionTokens = SupabaseSessionTokens & {
  rememberLogin: boolean;
};

type SupabaseEnvStatus = {
  hasSupabaseUrl: boolean;
  hasSupabaseAnonKey: boolean;
};

type SupabaseConfig = {
  supabaseAnonKey: string;
  supabaseUrl: string;
};

type PublicUserStatusRow = {
  status: KingUserStatus;
};

type AccountLoginSessionStatusRow = {
  revoked_at: string | null;
};

type SupabaseCookieWriter = {
  delete: (name: string) => unknown;
};

type SupabaseCookieSessionWriter = SupabaseCookieWriter & {
  set: (
    name: string,
    value: string,
    options: ReturnType<typeof getSupabaseCookieOptions>,
  ) => unknown;
};

export function getSupabaseCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(maxAge ? { maxAge } : {}),
  };
}

export function isSupabaseAuthTokenCookieName(name: string) {
  return (
    name.startsWith("sb-") &&
    (name.endsWith("-auth-token") || name.includes("-auth-token."))
  );
}

export function clearSupabaseSessionCookieWriter(
  cookieStore: SupabaseCookieWriter,
  cookieNames: string[] = [],
) {
  cookieStore.delete(ACCESS_TOKEN_COOKIE);
  cookieStore.delete(REFRESH_TOKEN_COOKIE);
  clearPendingMfaSessionCookieWriter(cookieStore);

  for (const name of cookieNames.filter(isSupabaseAuthTokenCookieName)) {
    cookieStore.delete(name);
  }
}

export function clearPendingMfaSessionCookieWriter(
  cookieStore: SupabaseCookieWriter,
) {
  cookieStore.delete(PENDING_MFA_ACCESS_TOKEN_COOKIE);
  cookieStore.delete(PENDING_MFA_REFRESH_TOKEN_COOKIE);
  cookieStore.delete(PENDING_MFA_REMEMBER_COOKIE);
}

export function setPendingMfaSessionCookieWriter(
  cookieStore: SupabaseCookieSessionWriter,
  input: PendingMfaSessionTokens,
) {
  const options = getSupabaseCookieOptions(PENDING_MFA_MAX_AGE_SECONDS);

  cookieStore.set(PENDING_MFA_ACCESS_TOKEN_COOKIE, input.accessToken, options);
  cookieStore.set(PENDING_MFA_REFRESH_TOKEN_COOKIE, input.refreshToken, options);
  cookieStore.set(
    PENDING_MFA_REMEMBER_COOKIE,
    input.rememberLogin ? "1" : "0",
    options,
  );
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return { supabaseUrl, supabaseAnonKey };
}

export function getSupabaseEnvStatus(): SupabaseEnvStatus {
  return {
    hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
    hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()),
  };
}

export function createSupabaseServerClient() {
  const config = getSupabaseConfig();

  if (!config) {
    return null;
  }

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createUserScopedSupabaseServerClient(accessToken: string) {
  const config = getSupabaseConfig();

  if (!config) {
    return null;
  }

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export async function createAuthenticatedSupabaseServerClient() {
  const config = getSupabaseConfig();
  const accessToken = await getAccessTokenFromRequest();

  if (!config || !accessToken) {
    return null;
  }

  const accessTokenAllowed = await isAccessTokenAllowedForAppSession(
    config,
    accessToken,
  );

  if (!accessTokenAllowed) {
    return null;
  }

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export async function createAuthenticatedSupabaseAuthSessionServerClient() {
  const config = getSupabaseConfig();
  const sessionTokens = await getSupabaseSessionTokensFromRequest();

  if (!config || !sessionTokens) {
    return null;
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.setSession({
    access_token: sessionTokens.accessToken,
    refresh_token: sessionTokens.refreshToken,
  });

  if (error || !data.session || !data.user) {
    return null;
  }

  const accessTokenAllowed = await isAccessTokenAllowedForAppSession(
    config,
    data.session.access_token,
  );

  if (!accessTokenAllowed) {
    return null;
  }

  return supabase;
}

export async function createPendingMfaSupabaseAuthSessionServerClient() {
  const config = getSupabaseConfig();
  const sessionTokens = await getPendingMfaSessionTokensFromRequest();

  if (!config || !sessionTokens) {
    return null;
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.setSession({
    access_token: sessionTokens.accessToken,
    refresh_token: sessionTokens.refreshToken,
  });

  if (error || !data.session || !data.user) {
    return null;
  }

  return {
    rememberLogin: sessionTokens.rememberLogin,
    supabase,
  };
}

async function isAccessTokenAllowedForAppSession(
  config: SupabaseConfig,
  accessToken: string,
) {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(
    accessToken,
  );

  if (authError || !authData.user) {
    return false;
  }

  const { data: userStatus, error: userStatusError } = await supabase
    .from("users")
    .select("status")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle<PublicUserStatusRow>();

  if (userStatusError) {
    console.error("Unable to verify public user status for app session", {
      authUserId: authData.user.id,
      code: userStatusError.code,
      message: userStatusError.message,
      details: userStatusError.details,
      hint: userStatusError.hint,
    });
    return false;
  }

  if (userStatus?.status) {
    if (isDeniedKingUserStatus(userStatus.status)) {
      return false;
    }

    return isAppLoginSessionCookieAllowed(config, accessToken, authData.user.id);
  }

  const { data: authIdentityDeleted, error: authIdentityDeletedError } =
    await supabase.rpc("auth_identity_is_deleted", {
      p_auth_user_id: authData.user.id,
    });

  if (authIdentityDeletedError) {
    if (
      authIdentityDeletedError.code !== "42883" &&
      authIdentityDeletedError.code !== "42P01"
    ) {
      console.error("Unable to verify deleted auth identity for app session", {
        authUserId: authData.user.id,
        code: authIdentityDeletedError.code,
        details: authIdentityDeletedError.details,
        hint: authIdentityDeletedError.hint,
        message: authIdentityDeletedError.message,
      });
    }

    return isAppLoginSessionCookieAllowed(config, accessToken, authData.user.id);
  }

  if (authIdentityDeleted === true) {
    return false;
  }

  return isAppLoginSessionCookieAllowed(config, accessToken, authData.user.id);
}

function isAccountLoginSecuritySchemaMissing(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined) {
  const message = error?.message ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST202" ||
    (error?.code === "PGRST205" && /account_login_sessions/i.test(message))
  );
}

async function isAppLoginSessionCookieAllowed(
  config: SupabaseConfig,
  accessToken: string,
  authUserId: string,
) {
  const loginSessionId = (await cookies()).get(
    ACCOUNT_LOGIN_SESSION_COOKIE,
  )?.value;

  if (!isAccountLoginSessionId(loginSessionId)) {
    return true;
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
  const { data, error } = await supabase
    .from("account_login_sessions")
    .select("revoked_at")
    .eq("id", loginSessionId)
    .eq("auth_user_id", authUserId)
    .maybeSingle<AccountLoginSessionStatusRow>();

  if (error) {
    if (isAccountLoginSecuritySchemaMissing(error)) {
      return true;
    }

    console.error("Unable to verify app login session", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return false;
  }

  return data?.revoked_at ? false : true;
}

export async function getAccessTokenFromRequest() {
  const authorization = (await headers()).get("authorization");
  const bearerPrefix = "Bearer ";

  if (authorization?.startsWith(bearerPrefix)) {
    return authorization.slice(bearerPrefix.length);
  }

  const cookieStore = await cookies();
  const directCookie = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  return directCookie ?? null;
}

export async function getSupabaseSessionTokensFromRequest(): Promise<SupabaseSessionTokens | null> {
  const authorization = (await headers()).get("authorization");
  const bearerPrefix = "Bearer ";
  const bearerToken = authorization?.startsWith(bearerPrefix)
    ? authorization.slice(bearerPrefix.length)
    : null;
  const cookieStore = await cookies();
  const directAccessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const directRefreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
  const accessToken = bearerToken || directAccessToken;

  if (accessToken && directRefreshToken) {
    return {
      accessToken,
      refreshToken: directRefreshToken,
    };
  }

  return null;
}

export async function getPendingMfaSessionTokensFromRequest(): Promise<PendingMfaSessionTokens | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(PENDING_MFA_ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = cookieStore.get(PENDING_MFA_REFRESH_TOKEN_COOKIE)?.value;

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    rememberLogin: cookieStore.get(PENDING_MFA_REMEMBER_COOKIE)?.value === "1",
  };
}

export async function setSupabaseSessionCookies(session: Session) {
  const cookieStore = await cookies();

  cookieStore.set(
    ACCESS_TOKEN_COOKIE,
    session.access_token,
    getSupabaseCookieOptions(session.expires_in),
  );
  cookieStore.set(
    REFRESH_TOKEN_COOKIE,
    session.refresh_token,
    getSupabaseCookieOptions(60 * 60 * 24 * 30),
  );
}

export async function clearSupabaseSessionCookies() {
  const cookieStore = await cookies();
  clearSupabaseSessionCookieWriter(
    cookieStore,
    cookieStore.getAll().map((cookie) => cookie.name),
  );
}

export async function getSupabaseAuthUser() {
  const supabase = createSupabaseServerClient();
  const accessToken = await getAccessTokenFromRequest();

  if (!supabase || !accessToken) {
    return null;
  }

  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}
