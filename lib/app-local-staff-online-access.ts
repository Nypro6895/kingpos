import type { AppLocalContext } from "./app-local-host";

const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

/** Fresh server proof admits only online Staff presentation. It is never a
 * display lease, a background read capability, or authority to restore disk data. */
export function isAppLocalStaffOnlineAccess(value: AppLocalContext, options: { path?: string; online: boolean; now?: number }): boolean {
  if (!options.online || !value || value.schemaVersion !== 1 || value.offline || value.offlineState !== "online-only"
    || value.grant !== null || value.grantStatus !== 503 || value.access?.staffWorkspace !== true) return false;
  if (options.path !== undefined && !/^\/staff\/(?:my-work|workday|appointments)$/.test(options.path.split("?")[0].replace(/\/$/, ""))) return false;
  const context = value.context, proof = value.staffOnlineAccess, now = options.now ?? Date.now();
  if (!context || context.authenticated !== true || !uuid(context.viewerId) || !uuid(context.salonId)
    || typeof context.scope !== "string" || !/^v3:[a-f0-9]{64}$/.test(context.scope)
    || typeof context.permissionRevision !== "string" || !context.permissionRevision
    || !proof || proof.version !== 1 || !uuid(proof.staffId) || proof.viewerId !== context.viewerId
    || proof.salonId !== context.salonId || proof.scope !== context.scope) return false;
  return typeof value.onlineValidatedAt === "number" && Number.isFinite(value.onlineValidatedAt)
    && value.onlineValidatedAt > 0 && value.onlineValidatedAt <= now + 60_000 && now - value.onlineValidatedAt < 30_000;
}
