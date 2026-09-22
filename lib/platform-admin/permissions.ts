import "server-only";

import {
  PLATFORM_ADMIN_PERMISSIONS,
  type PlatformAdminPermission,
} from "@/types/platform-admin";

export { PLATFORM_ADMIN_PERMISSIONS };
export type { PlatformAdminPermission };

const PLATFORM_ADMIN_PERMISSION_VALUES = new Set<string>(
  Object.values(PLATFORM_ADMIN_PERMISSIONS),
);

export function isPlatformAdminPermission(
  permission: string,
): permission is PlatformAdminPermission {
  return PLATFORM_ADMIN_PERMISSION_VALUES.has(permission);
}
