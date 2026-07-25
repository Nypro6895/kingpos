import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createSupabaseServerClient,
  createUserScopedSupabaseServerClient,
  getSupabaseCookieOptions,
} from "@/lib/supabase/server";
import {
  CURRENT_MANAGE_SALON_COOKIE,
  CURRENT_STAFF_SALON_COOKIE,
  LEGACY_CURRENT_SALON_COOKIE,
  SELECTED_WORKSPACE_COOKIE,
  getStaffWorkspaceId,
} from "@/lib/current-context";
import {
  getStaffInviteByToken,
  verifyStaffInviteEmail,
} from "@/lib/staff-salon-connections";
import { getKingUserForAuthUser } from "@/lib/users/current-user";
import { NextResponse } from "next/server";
import type { StaffConnectionRpcResult } from "@/types/staff-salon-connection";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getWorkspaceCookieOptions() {
  return getSupabaseCookieOptions(60 * 60 * 24 * 365);
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const formData = await request.formData();
  const token = readString(formData, "token");
  const email = readString(formData, "email").toLowerCase();
  const password = readString(formData, "password");

  if (!supabase) {
    return jsonError("Supabase environment variables are missing.", 500);
  }

  if (!token || !email || !password) {
    return jsonError("Invitation token, email, and password are required.");
  }

  let invite: Awaited<ReturnType<typeof getStaffInviteByToken>>;

  try {
    invite = await getStaffInviteByToken(token);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Invitation could not be loaded.",
      400,
    );
  }

  if (invite.status === "invalid") {
    return jsonError("This invitation link is invalid.");
  }

  if (invite.status !== "pending" || invite.is_expired) {
    return jsonError("This invitation is no longer pending.");
  }

  if (invite.target.has_account_target) {
    return jsonError(
      "This invitation is for an existing Reylumi account. Log in with that account to accept it.",
    );
  }

  if (!invite.target.masked_email) {
    return jsonError(
      "This invitation does not include an email target. Ask the salon to resend it to your email.",
    );
  }

  let verification: Awaited<ReturnType<typeof verifyStaffInviteEmail>>;

  try {
    verification = await verifyStaffInviteEmail({ email, token });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Invited email could not be verified.",
      400,
    );
  }

  if (verification.requires_existing_account) {
    return jsonError(
      "This invitation is for an existing Reylumi account. Log in with that account to accept it.",
    );
  }

  if (!verification.email_matches) {
    return jsonError(
      verification.reason ?? "Email does not match the invited email.",
    );
  }

  const { data: signupData, error: signupError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: invite.staff.display_name,
        staff_invite_request_id: invite.request_id,
        staff_invite_salon_id: invite.salon.id,
      },
    },
  });

  if (signupError) {
    return jsonError(signupError.message);
  }

  if (!signupData.user || !signupData.session) {
    const loginParams = new URLSearchParams({
      message:
        "Account created. Confirm your email, then log in from this invitation link to finish connecting.",
      next: `/staff/invite/${encodeURIComponent(token)}`,
    });

    return NextResponse.json({
      redirectTo: `/login?${loginParams.toString()}`,
    });
  }

  const publicUser = await getKingUserForAuthUser(
    signupData.user,
    signupData.session.access_token,
  );

  if (!publicUser) {
    return jsonError("Account was created, but the profile could not be prepared.");
  }

  const userScopedSupabase = createUserScopedSupabaseServerClient(
    signupData.session.access_token,
  );

  if (!userScopedSupabase) {
    return jsonError("Supabase environment variables are missing.", 500);
  }

  const { data: acceptData, error: acceptError } = await userScopedSupabase.rpc(
    "accept_staff_connection_invite",
    {
      p_token: token,
    },
  );

  if (acceptError) {
    return jsonError(
      `Account was created, but the invitation could not be connected: ${acceptError.message}`,
    );
  }

  const acceptedInvite = acceptData as StaffConnectionRpcResult;
  const response = NextResponse.json({
    redirectTo:
      "/staff/connections?connection_notice=Invitation accepted. Your staff account is connected.",
  });

  response.cookies.set(
    ACCESS_TOKEN_COOKIE,
    signupData.session.access_token,
    getSupabaseCookieOptions(signupData.session.expires_in),
  );
  response.cookies.set(
    REFRESH_TOKEN_COOKIE,
    signupData.session.refresh_token,
    getSupabaseCookieOptions(60 * 60 * 24 * 30),
  );

  if (acceptedInvite.salon_id) {
    response.cookies.set(
      CURRENT_STAFF_SALON_COOKIE,
      acceptedInvite.salon_id,
      getWorkspaceCookieOptions(),
    );
    response.cookies.set(
      SELECTED_WORKSPACE_COOKIE,
      getStaffWorkspaceId(acceptedInvite.salon_id),
      getWorkspaceCookieOptions(),
    );
    response.cookies.delete(CURRENT_MANAGE_SALON_COOKIE);
    response.cookies.delete(LEGACY_CURRENT_SALON_COOKIE);
  }

  return response;
}
