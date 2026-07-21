import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

export const ACCESS_TOKEN_COOKIE = "sb-access-token";
export const REFRESH_TOKEN_COOKIE = "sb-refresh-token";

type SupabaseEnvStatus = {
  hasSupabaseUrl: boolean;
  hasSupabaseAnonKey: boolean;
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

export function getSupabaseConfig() {
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

export async function createAuthenticatedSupabaseServerClient() {
  const config = getSupabaseConfig();
  const accessToken = await getAccessTokenFromRequest();

  if (!config || !accessToken) {
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

function readTokenFromCookieValue(value: string) {
  const decodedValue = decodeURIComponent(value);

  if (decodedValue.startsWith("base64-")) {
    const rawJson = Buffer.from(decodedValue.slice("base64-".length), "base64").toString(
      "utf8",
    );
    const parsed = JSON.parse(rawJson) as { access_token?: string };
    return parsed.access_token ?? null;
  }

  if (decodedValue.startsWith("{")) {
    const parsed = JSON.parse(decodedValue) as { access_token?: string };
    return parsed.access_token ?? null;
  }

  if (decodedValue.startsWith("[")) {
    const parsed = JSON.parse(decodedValue) as string[];
    return parsed[0] ?? null;
  }

  return decodedValue || null;
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
