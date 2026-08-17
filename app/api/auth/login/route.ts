import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createSupabaseServerClient,
  getSupabaseCookieOptions,
} from "@/lib/supabase/server";
import {
  fallbackPostAuthWorkspaceNavigation,
  getPostAuthWorkspaceNavigation,
} from "@/lib/post-auth-routing";
import { getSupabaseAuthErrorResponse } from "@/lib/supabase/auth-errors";
import { writeNormalizedWorkspaceContextCookies } from "@/lib/current-context";
import { NextResponse } from "next/server";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const formData = await request.formData();
  const email = readString(formData, "email").toLowerCase();
  const password = readString(formData, "password");
  const requestedPath = readString(formData, "next");

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase environment variables are missing." },
      { status: 500 },
    );
  }

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    const authError = getSupabaseAuthErrorResponse(error, "Unable to log in.");

    return NextResponse.json(
      { error: authError.message },
      { status: authError.status },
    );
  }

  const navigation = await getPostAuthWorkspaceNavigation({
    accessToken: data.session.access_token,
    requestedPath,
  }).catch((error: unknown) => {
    console.error("Unable to resolve post-login workspace navigation", {
      message: error instanceof Error ? error.message : String(error),
    });

    return fallbackPostAuthWorkspaceNavigation();
  });
  const response = NextResponse.json({ redirectTo: navigation.redirectTo });
  response.cookies.set(
    ACCESS_TOKEN_COOKIE,
    data.session.access_token,
    getSupabaseCookieOptions(data.session.expires_in),
  );
  response.cookies.set(
    REFRESH_TOKEN_COOKIE,
    data.session.refresh_token,
    getSupabaseCookieOptions(60 * 60 * 24 * 30),
  );
  if (navigation.workspace) {
    writeNormalizedWorkspaceContextCookies(response.cookies, navigation.workspace);
  }

  return response;
}
