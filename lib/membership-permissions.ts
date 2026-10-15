import type { SupabaseClient } from "@supabase/supabase-js";

type MembershipRole = { id: string; role_id: string | null };
type RolePermission = { role_id: string; permission_id: string };
type Permission = { id: string; code: string };

// Read each role once, but keep the grants separate for each membership scope.
export async function loadMembershipPermissionCodes(
  memberships: MembershipRole[],
  supabase: SupabaseClient | null,
): Promise<Map<string, Set<string>>> {
  const result = new Map(memberships.map((membership) => [membership.id, new Set<string>()]));
  const roleIds = [...new Set(memberships.map((membership) => membership.role_id).filter((id): id is string => Boolean(id)))];
  if (!supabase || roleIds.length === 0) return result;

  const rolePermissionsResult = await supabase
    .from("role_permissions")
    .select("role_id, permission_id")
    .in("role_id", roleIds)
    .returns<RolePermission[]>();
  if (rolePermissionsResult.error) throw new Error(rolePermissionsResult.error.message);

  const rolePermissions = rolePermissionsResult.data ?? [];
  const permissionIds = [...new Set(rolePermissions.map((row) => row.permission_id))];
  if (permissionIds.length === 0) return result;

  const permissionsResult = await supabase
    .from("permissions")
    .select("id, code")
    .in("id", permissionIds)
    .returns<Permission[]>();
  if (permissionsResult.error) throw new Error(permissionsResult.error.message);

  const codesById = new Map((permissionsResult.data ?? []).map((row) => [row.id, row.code]));
  const codesByRole = new Map<string, Set<string>>();
  for (const row of rolePermissions) {
    const code = codesById.get(row.permission_id);
    if (!code) continue;
    const codes = codesByRole.get(row.role_id) ?? new Set<string>();
    codes.add(code);
    codesByRole.set(row.role_id, codes);
  }
  for (const membership of memberships) {
    // Independent sets avoid a caller accidentally changing another grant.
    result.set(membership.id, new Set(membership.role_id ? codesByRole.get(membership.role_id) : undefined));
  }
  return result;
}
