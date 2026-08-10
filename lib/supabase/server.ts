import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import { isDeniedKingUserStatus } from "@/lib/users/account-status";
import type { KingUserStatus } from "@/types/user";
import { cookies, headers } from "next/headers";

export const ACCESS_TOKEN_COOKIE = "sb-access-token";
export const REFRESH_TOKEN_COOKIE = "sb-refresh-token";

type SupabaseSessionTokens = {
  accessToken: string;
  refreshToken: string;
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

export function getSupabaseCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(maxAge ? { maxAge } : {}),
  };
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

  return !isDeniedKingUserStatus(userStatus?.status);
}

function readSessionFromCookieValue(value: string): Partial<SupabaseSessionTokens> {
  const decodedValue = decodeURIComponent(value);

  if (decodedValue.startsWith("base64-")) {
    const rawJson = Buffer.from(decodedValue.slice("base64-".length), "base64").toString(
      "utf8",
    );
    return readSessionFromCookieValue(rawJson);
  }

  if (decodedValue.startsWith("{")) {
    const parsed = JSON.parse(decodedValue) as {
      access_token?: string;
      refresh_token?: string;
    };

    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
    };
  }

  if (decodedValue.startsWith("[")) {
    const parsed = JSON.parse(decodedValue) as string[];

    return {
      accessToken: parsed[0],
      refreshToken: parsed[1],
    };
  }

  return { accessToken: decodedValue || undefined };
}

function readTokenFromCookieValue(value: string) {
  return readSessionFromCookieValue(value).accessToken ?? null;
}

export async function getAccessTokenFromRequest() {
  const authorization = (await headers()).get("authorization");
  const bearerPrefix = "Bearer ";

  if (authorization?.startsWith(bearerPrefix)) {
    return authorization.slice(bearerPrefix.length);
  }

  const cookieStore = await cookies();
  const directCookie = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  if (directCookie) {
    return directCookie;
  }

  const authCookie = cookieStore
    .getAll()
    .find((cookie) => cookie.name.startsWith("sb-") && cookie.name.endsWith("-auth-token"));

  if (!authCookie) {
    return null;
  }

  try {
    return readTokenFromCookieValue(authCookie.value);
  } catch {
    return null;
  }
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

  const authCookie = cookieStore
    .getAll()
    .find((cookie) => cookie.name.startsWith("sb-") && cookie.name.endsWith("-auth-token"));

  if (!authCookie) {
    return null;
  }

  try {
    const sessionTokens = readSessionFromCookieValue(authCookie.value);

    if (sessionTokens.accessToken && sessionTokens.refreshToken) {
      return {
        accessToken: sessionTokens.accessToken,
        refreshToken: sessionTokens.refreshToken,
      };
    }
  } catch {
    return null;
  }

  return null;
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

  cookieStore.delete(ACCESS_TOKEN_COOKIE);
  cookieStore.delete(REFRESH_TOKEN_COOKIE);

  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith("sb-") && cookie.name.endsWith("-auth-token")) {
      cookieStore.delete(cookie.name);
    }
  }
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
