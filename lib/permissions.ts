import "server-only";

import { getCurrentBusinessContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { Permission, RolePermission } from "@/types/permission";
import type { Role } from "@/types/role";

export const PERMISSION_SELECT =
  "id, code, name, description, category, is_system, created_at, updated_at";

export const ROLE_PERMISSION_SELECT = "id, role_id, permission_id, created_at";

export type RoleWithPermissions = Role & {
  permissions: Permission[];
};

export type OrganizationPermissionSet = {
  permissions: Permission[];
  roles: RoleWithPermissions[];
};

export async function getCurrentRolePermissionCodes(
  context?: CurrentBusinessContext,
) {
  const resolvedContext = context ?? (await getCurrentBusinessContext());
  const roleId = resolvedContext.currentMembership?.role_id;

  if (!resolvedContext.user || !resolvedContext.currentOrganization || !roleId) {
    return new Set<string>();
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data: rolePermissions, error: rolePermissionsError } = await supabase
    .from("role_permissions")
    .select(ROLE_PERMISSION_SELECT)
    .eq("role_id", roleId)
    .returns<RolePermission[]>();

  if (rolePermissionsError) {
    console.error("Supabase load current role permissions failed", {
      code: rolePermissionsError.code,
      message: rolePermissionsError.message,
      details: rolePermissionsError.details,
      hint: rolePermissionsError.hint,
      roleId,
      organizationId: resolvedContext.currentOrganization.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(rolePermissionsError.message);
  }

  const permissionIds = (rolePermissions ?? []).map(
    (rolePermission) => rolePermission.permission_id,
  );

  if (permissionIds.length === 0) {
    return new Set<string>();
  }

  const { data: permissions, error: permissionsError } = await supabase
    .from("permissions")
    .select(PERMISSION_SELECT)
    .in("id", permissionIds)
    .returns<Permission[]>();

  if (permissionsError) {
    console.error("Supabase load permission codes failed", {
      code: permissionsError.code,
      message: permissionsError.message,
      details: permissionsError.details,
      hint: permissionsError.hint,
      roleId,
      organizationId: resolvedContext.currentOrganization.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(permissionsError.message);
  }

  return new Set((permissions ?? []).map((permission) => permission.code));
}

export async function hasPermission(
  permissionCode: string,
  context?: CurrentBusinessContext,
) {
  const permissionCodes = await getCurrentRolePermissionCodes(context);
  return permissionCodes.has(permissionCode);
}

export async function requirePermission(
  permissionCode: string,
  context?: CurrentBusinessContext,
) {
  const allowed = await hasPermission(permissionCode, context);

  if (!allowed) {
    throw new Error(`Missing required permission: ${permissionCode}`);
  }
}

export async function getOrganizationPermissionSet(
  organizationId: string,
  roles: Role[],
): Promise<OrganizationPermissionSet> {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data: permissions, error: permissionsError } = await supabase
    .from("permissions")
    .select(PERMISSION_SELECT)
    .order("category", { ascending: true })
    .order("code", { ascending: true })
    .returns<Permission[]>();

  if (permissionsError) {
    console.error("Supabase load permissions failed", {
      code: permissionsError.code,
      message: permissionsError.message,
      details: permissionsError.details,
      hint: permissionsError.hint,
      organizationId,
    });
    throw new Error(permissionsError.message);
  }

  const roleIds = roles.map((role) => role.id);
  const { data: rolePermissions, error: rolePermissionsError } =
    roleIds.length > 0
      ? await supabase
          .from("role_permissions")
          .select(ROLE_PERMISSION_SELECT)
          .in("role_id", roleIds)
          .returns<RolePermission[]>()
      : { data: [], error: null };

  if (rolePermissionsError) {
    console.error("Supabase load organization role permissions failed", {
      code: rolePermissionsError.code,
      message: rolePermissionsError.message,
      details: rolePermissionsError.details,
      hint: rolePermissionsError.hint,
      organizationId,
    });
    throw new Error(rolePermissionsError.message);
  }

  const permissionById = new Map(
    (permissions ?? []).map((permission) => [permission.id, permission]),
  );
  const permissionsByRoleId = new Map<string, Permission[]>();

  for (const rolePermission of rolePermissions ?? []) {
    const permission = permissionById.get(rolePermission.permission_id);

    if (!permission) {
      continue;
    }

    const rolePermissionList = permissionsByRoleId.get(rolePermission.role_id) ?? [];
    rolePermissionList.push(permission);
    permissionsByRoleId.set(rolePermission.role_id, rolePermissionList);
  }

  return {
    permissions: permissions ?? [],
    roles: roles.map((role) => ({
      ...role,
      permissions: (permissionsByRoleId.get(role.id) ?? []).sort((left, right) =>
        left.code.localeCompare(right.code),
      ),
    })),
  };
}
