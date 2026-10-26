import { sanitizeAuthReturnPath } from "@/lib/auth-routing";

// Metadata only resumes onboarding; it is never proof of phone ownership.
export function signupPhonePath(next?: string | null) {
  const safe = sanitizeAuthReturnPath(next, "/activity");
  const target = safe === "/explore" ? "/activity" : safe;
  if (target === "/welcome/phone" || target.startsWith("/welcome/phone?")) return target;
  return `/welcome/phone?next=${encodeURIComponent(target)}`;
}

export function resumeSignupPhonePath(
  user: { user_metadata?: Record<string, unknown> } | null,
  next?: string | null,
) {
  const metadata = user?.user_metadata;
  return typeof metadata?.signup_phone === "string" && !metadata.signup_phone_complete
    ? signupPhonePath(next)
    : sanitizeAuthReturnPath(next);
}
