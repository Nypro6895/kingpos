import {
  ACCOUNT_LOGIN_SESSION_COOKIE,
} from "@/lib/account-security-shared";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearPendingMfaSessionCookieWriter,
  createSupabaseServerClient,
  getSupabaseCookieOptions,
  setPendingMfaSessionCookieWriter,
} from "@/lib/supabase/server";
import { recordAccountLoginForSession } from "@/lib/account-security";
import {
  fallbackPostAuthWorkspaceNavigation,
  getPostAuthWorkspaceNavigation,
} from "@/lib/post-auth-routing";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import { getSupabaseAuthErrorResponse } from "@/lib/supabase/auth-errors";
import {
  clearWorkspaceContextCookies,
  writeNormalizedWorkspaceContextCookies,
} from "@/lib/current-context";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

const LOGIN_PATH = "/login";
const REMEMBERED_LOGIN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type LoginMfaFactor = {
  factor_type: "phone" | "totp";
  id: string;
  phone?: string | null;
  status: string;
};

type LoginMfaChallenge = {
  challengeId: string;
  expiresAt: number | null;
  factorId: string;
  factorType: "phone" | "totp";
  phone: string | null;
};

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function wantsJsonResponse(request: Request) {
  return (request.headers.get("accept") ?? "")
    .toLowerCase()
    .includes("application/json");
}

function redirectResponse(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

function loginErrorResponse(
  request: Request,
  message: string,
  status: number,
  nextPath: string,
) {
  if (wantsJsonResponse(request)) {
    return NextResponse.json({ error: message }, { status });
  }

  const params = new URLSearchParams({
    error: message,
    next: nextPath,
  });

  return redirectResponse(request, `${LOGIN_PATH}?${params.toString()}`);
}

function loginSuccessResponse(request: Request, redirectTo: string) {
  if (wantsJsonResponse(request)) {
    return NextResponse.json({ redirectTo });
  }

  return redirectResponse(request, redirectTo);
}

function chooseLoginMfaFactor(data: unknown): LoginMfaFactor | null {
  const factors = data as
    | {
        phone?: LoginMfaFactor[];
        totp?: LoginMfaFactor[];
      }
    | null
    | undefined;
  const verifiedPhoneFactor = (factors?.phone ?? []).find(
    (factor) => factor.status === "verified",
  );
  const verifiedTotpFactor = (factors?.totp ?? []).find(
    (factor) => factor.status === "verified",
  );

  return verifiedPhoneFactor ?? verifiedTotpFactor ?? null;
}

async function createLoginMfaChallenge(
  supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>,
): Promise<
  | {
      challenge: LoginMfaChallenge | null;
      error: null;
    }
  | {
      challenge?: never;
      error: string;
    }
> {
  const [assuranceResult, factorsResult] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);

  if (assuranceResult.error) {
    return {
      error:
        assuranceResult.error.message ||
        "Two-factor authentication status could not be checked.",
    };
  }

  if (
    assuranceResult.data?.currentLevel === "aal2" ||
    assuranceResult.data?.nextLevel !== "aal2"
  ) {
    return {
      challenge: null,
      error: null,
    };
  }

  if (factorsResult.error) {
    return {
      error:
        factorsResult.error.message ||
        "Two-factor authentication methods could not be loaded.",
    };
  }

  const factor = chooseLoginMfaFactor(factorsResult.data);

  if (!factor) {
    return {
      error: "Two-factor authentication is required, but no verified factor was found.",
    };
  }

  const challengeResult = await supabase.auth.mfa.challenge(
    factor.factor_type === "phone"
      ? { channel: "sms", factorId: factor.id }
      : { factorId: factor.id },
  );

  if (challengeResult.error || !challengeResult.data?.id) {
    return {
      error:
        challengeResult.error?.message ||
        "Two-factor verification could not be started.",
    };
  }

  return {
    challenge: {
      challengeId: challengeResult.data.id,
      expiresAt: challengeResult.data.expires_at ?? null,
      factorId: factor.id,
      factorType: factor.factor_type,
      phone: factor.phone ?? null,
    },
    error: null,
  };
}

function loginMfaRequiredResponse(input: {
  challenge: LoginMfaChallenge;
  nextPath: string;
  rememberLogin: boolean;
  request: Request;
  session: {
    access_token: string;
    refresh_token: string;
  };
}) {
  if (!wantsJsonResponse(input.request)) {
    return loginErrorResponse(
      input.request,
      "Two-factor verification is required. Use the app login form.",
      403,
      input.nextPath,
    );
  }

  const response = NextResponse.json({
    mfa: input.challenge,
  });

  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
  response.cookies.delete(ACCOUNT_LOGIN_SESSION_COOKIE);
  clearPendingMfaSessionCookieWriter(response.cookies);
  setPendingMfaSessionCookieWriter(response.cookies, {
    accessToken: input.session.access_token,
    refreshToken: input.session.refresh_token,
    rememberLogin: input.rememberLogin,
  });
  clearWorkspaceContextCookies(response.cookies);

  return response;
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const formData = await request.formData();
  const email = readString(formData, "email").toLowerCase();
  const password = readString(formData, "password");
  const requestedPath = readString(formData, "next");
  const nextPath = sanitizeAuthReturnPath(requestedPath);
  const rememberLogin = formData.get("remember_me") === "on";

  if (!supabase) {
    return loginErrorResponse(
      request,
      "This feature is temporarily unavailable. Please try again later.",
      500,
      nextPath,
    );
  }

  if (!email || !password) {
    return loginErrorResponse(
      request,
      "Email and password are required.",
      400,
      nextPath,
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    const authError = getSupabaseAuthErrorResponse(error, "Unable to log in.");

    return loginErrorResponse(
      request,
      authError.message,
      authError.status,
      nextPath,
    );
  }

  const mfaChallenge = await createLoginMfaChallenge(supabase);

  if (mfaChallenge.error) {
    return loginErrorResponse(request, mfaChallenge.error, 403, nextPath);
  }

  if (mfaChallenge.challenge) {
    return loginMfaRequiredResponse({
      challenge: mfaChallenge.challenge,
      nextPath,
      rememberLogin,
      request,
      session: data.session,
    });
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
  const loginSessionId = randomUUID();

  await recordAccountLoginForSession({
    accessToken: data.session.access_token,
    requestHeaders: request.headers,
    sessionId: loginSessionId,
  }).catch((error: unknown) => {
    console.error("Unable to record login security session", {
      message: error instanceof Error ? error.message : String(error),
    });
  });

  const response = loginSuccessResponse(request, navigation.redirectTo);
  const accessTokenMaxAge = rememberLogin ? data.session.expires_in : undefined;
  const sessionMaxAge = rememberLogin
    ? REMEMBERED_LOGIN_MAX_AGE_SECONDS
    : undefined;

  response.cookies.set(
    ACCESS_TOKEN_COOKIE,
    data.session.access_token,
    getSupabaseCookieOptions(accessTokenMaxAge),
  );
  response.cookies.set(
    REFRESH_TOKEN_COOKIE,
    data.session.refresh_token,
    getSupabaseCookieOptions(sessionMaxAge),
  );
  response.cookies.set(
    ACCOUNT_LOGIN_SESSION_COOKIE,
    loginSessionId,
    getSupabaseCookieOptions(sessionMaxAge),
  );
  clearPendingMfaSessionCookieWriter(response.cookies);
  if (navigation.workspace) {
    writeNormalizedWorkspaceContextCookies(response.cookies, navigation.workspace);
  }

  return response;
}
