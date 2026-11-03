import type { ReactNode } from "react";
import { GuestNavigationShell } from "@/app/guest-navigation-shell";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { SalonSwitcher } from "@/app/salon-switcher";

export async function LegalNavigationShell({ children }: { children: ReactNode }) {
  // Read the same HttpOnly session as the workspace.
  // An unavailable auth service must not present a signed-in reader as a guest.
  let authenticated: boolean | null = null;
  try {
    authenticated = Boolean(await createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }));
  } catch {
    // Policy content stays readable while account status is unavailable.
  }
  if (authenticated) {
    try {
      const context = await getRequestBusinessContext();
      if (context?.user) {
        // Await the server shell here so a failed permission/context read cannot
        // replace publicly readable Help or policy content with an error page.
        return await SalonSwitcher({ context, children });
      }
    } catch {
      // Help and policy content remain readable if workspace data is unavailable.
    }
  }
  return <GuestNavigationShell authenticated={authenticated}>{children}</GuestNavigationShell>;
}
