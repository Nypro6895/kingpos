import "server-only";

import { isSalonManageContext, type CurrentBusinessContext } from "./current-context";
import { getExperienceContext } from "./experience-context";
import { hasPermission } from "./permissions";
import { getCurrentSalonServicesWorkspace, SERVICE_PERMISSIONS } from "./services";
import { runReadWithDeadline } from "./bounded-get";
import { isServicesCatalog } from "./services-catalog-cache";
import type { AppLocalServicesCatalogAdmissionData, AppLocalServicesCatalogData } from "./app-local-platform-types";

export class ServicesCatalogAdmissionError extends Error {
  constructor(readonly status: 401 | 403 | 409, message: string) { super(message); this.name = "ServicesCatalogAdmissionError"; }
}

/** The caller supplies this request's server-resolved identity, never a client
 * context or an offline lease. Reuse the original exact feature permission.
 * Lookup failures deliberately propagate to the transport's existing 503 path.
 */
export async function admitServicesCatalog(context: CurrentBusinessContext, expectedScope: string | null): Promise<AppLocalServicesCatalogAdmissionData> {
  if (!context.user) throw new ServicesCatalogAdmissionError(401, "Sign in to view services.");
  if (!isSalonManageContext(context) || !context.currentAccount || !context.currentSalon
    || !await runReadWithDeadline(hasPermission(SERVICE_PERMISSIONS.view, context), 5_000)) {
    throw new ServicesCatalogAdmissionError(403, "You do not have permission to view services.");
  }
  const experience = getExperienceContext(context);
  if (experience.scope !== expectedScope) throw new ServicesCatalogAdmissionError(409, "Workspace changed. Open Services again.");
  return { schemaVersion: 1, partition: {
    viewerId: context.user.id, accountId: context.currentAccount.id, salonId: context.currentSalon.id,
    scope: experience.scope, permissionRevision: experience.permissionRevision,
  } };
}

/** Only the approved six catalog fields cross this transport. In particular,
 * staff, assignments and canManage never enter a pilot native read envelope.
 * The original workspace reader still owns server authorization/data access.
 */
export async function readServicesCatalog(context: CurrentBusinessContext, expectedScope: string): Promise<AppLocalServicesCatalogData> {
  await admitServicesCatalog(context, expectedScope);
  const workspace = await runReadWithDeadline(getCurrentSalonServicesWorkspace(context), 15_000);
  const data = { services: workspace.services.map(service => ({
    id: service.id, name: service.name, category: service.category, description: service.description,
    basePrice: Number(service.base_price), durationMinutes: service.duration_minutes,
  })) };
  if (!isServicesCatalog(data)) throw new Error("The service catalog could not be loaded.");
  return data;
}
