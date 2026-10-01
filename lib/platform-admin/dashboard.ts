import "server-only";

import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import type { PlatformAdminDashboard } from "@/types/platform-admin";

export async function getPlatformAdminDashboard() {
  return callPlatformAdminRpc<PlatformAdminDashboard>(
    "get_platform_admin_dashboard",
  );
}
