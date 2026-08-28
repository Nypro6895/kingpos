import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import { getSupabaseAuthErrorResponse } from "@/lib/supabase/auth-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const RESET_SENT_MESSAGE =
  "If a ReyLUMI account exists for this email, we will send password reset instructions.";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function resetPasswordRedirectUrl(request: Request, nextPath: string) {
  const url = new URL(request.url);
  const redirectUrl = new URL("/reset-password", url.origin);
  redirectUrl.searchParams.set("next", nextPath);

  return redirectUrl.toString();
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const formData = await request.formData();
  const email = readString(formData, "email").toLowerCase();
  const nextPath = sanitizeAuthReturnPath(readString(formData, "next"));

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase environment variables are missing." },
      { status: 500 },
    );
  }

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: resetPasswordRedirectUrl(request, nextPath),
  });

  if (error) {
    const authError = getSupabaseAuthErrorResponse(
      error,
      "Unable to send password reset instructions.",
    );

    return NextResponse.json(
      { error: authError.message },
      { status: authError.status },
    );
  }

  return NextResponse.json({ message: RESET_SENT_MESSAGE });
}
