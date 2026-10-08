import "server-only";
import { callPlatformAdminRpc } from "./rpc";
import type {
  BusinessWorkspace,
  BusinessRow,
} from "@/types/admin-business-workspace";
import { assertUuid } from "./validation";
export function getBusinessWorkspace(
  params: Record<string, string | string[] | undefined>,
) {
  const value = (key: string, fallback = "") =>
    (Array.isArray(params[key]) ? params[key][0] : params[key]) || fallback;
  const page = Number(value("page", "1"));
  return callPlatformAdminRpc<BusinessWorkspace>(
    "search_platform_admin_business_workspace",
    {
      p_page: Number.isSafeInteger(page) && page > 0 ? page : 1,
      p_query: value("q"),
      p_tab: value("tab", "all"),
      p_status: value("status"),
      p_ownership: value("ownership"),
      p_city: value("city"),
      p_sort: value("sort", "created_desc"),
    },
  );
}
export function getBusinessWorkspaceRecord(id: string) {
  return callPlatformAdminRpc<BusinessRow>(
    "get_platform_admin_business_workspace_record",
    { p_id: assertUuid(id) },
  );
}
