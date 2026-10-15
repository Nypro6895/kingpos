import type { ReactNode } from "react";
import { GuestNavigationShell } from "@/app/guest-navigation-shell";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

export async function LegalNavigationShell({ children }: { children: ReactNode }) {
  // Read the same HttpOnly session as the workspace, without loading salon data.
  // An unavailable auth service must not present a signed-in reader as a guest.
  let authenticated: boolean | null = null;
  try {
    authenticated = Boolean(await createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }));
  } catch {
    // Policy content stays readable while account status is unavailable.
  }
  return <GuestNavigationShell authenticated={authenticated}>{children}</GuestNavigationShell>;
}
