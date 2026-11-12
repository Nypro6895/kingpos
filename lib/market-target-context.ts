import "server-only";
import { getCurrentBusinessContext, isOwnerMembership } from "./current-context";
import { resolveSettingsTarget } from "./settings-target-context";
import { runInBusinessContext } from "./scoped-business-context";
export async function resolveMarketTarget(salonId?: string) {
 const current = await getCurrentBusinessContext();
 if (!current.user || current.user.status !== "active") throw new Error("Please sign in again.");
 const targetId = salonId ?? current.currentSalon?.id;
 if (!targetId || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(targetId)) throw new Error("Choose a salon you own to manage Market features.");
 const target = await resolveSettingsTarget(targetId, "manage");
 if (!isOwnerMembership(target.currentMembership) || target.currentSalon?.status !== "active" || target.currentAccount?.status !== "active") throw new Error("Owner access to this active salon is required.");
 return { ...target, user: current.user, currentSalon: target.currentSalon! };
}
export async function withMarketTarget<T>(salonId: string | undefined, action: () => Promise<T>): Promise<T> {
 if (!salonId) throw new Error("Choose a salon you own before continuing.");
 return runInBusinessContext(await resolveMarketTarget(salonId), action);
}
