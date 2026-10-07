"use server";

import { getCurrentKingUser } from "@/lib/users/current-user";
import { analyzeAccountDeletionImpact } from "@/lib/account-deletion";
import { loadLoginSecurityOverview } from "@/lib/account-security";
export async function loadPersonalSettingsSection(kind: "security" | "deletion") {
  const user = await getCurrentKingUser();
  if (!user) throw new Error("Sign in to view account settings.");
  if (kind === "deletion") return {kind, impact:await analyzeAccountDeletionImpact()} as const;
  if (kind === "security") { const overview=await loadLoginSecurityOverview();if(!overview)throw new Error("Security details could not be loaded.");return {kind, overview, user} as const; }
  throw new Error("Unknown settings section.");
}
