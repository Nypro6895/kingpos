import "server-only";
import { cache } from "react";

import { notFound, redirect } from "next/navigation";
import { loginHrefForReturnPath } from "@/lib/auth-routing";
import {
  PLATFORM_ADMIN_PERMISSIONS,
  type PlatformAdminPermission,
} from "@/lib/platform-admin/permissions";
import {
  createAuthenticatedSupabaseServerClient,
  getSupabaseAuthUser,
} from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type {
  PlatformAdminContext,
  PlatformAdminRoleSlug,
} from "@/types/platform-admin";

type PlatformAdminContextRow = {
  membership_id: string;
  permissions: string[] | null;
  role_id: string;
  role_name: string;
  role_slug: string;
  user_id: string;
};

function mapPlatformAdminContextRow(
  row: PlatformAdminContextRow,
): PlatformAdminContext {
  return {
    membershipId: row.membership_id,
    permissions: (row.permissions ?? []) as PlatformAdminPermission[],
    roleId: row.role_id,
    roleName: row.role_name,
    roleSlug: row.role_slug as PlatformAdminRoleSlug,
    userId: row.user_id,
  };
}

export const getCurrentPlatformAdminContext = cache(loadCurrentPlatformAdminContext);

async function loadCurrentPlatformAdminContext() {
  const [currentUser, supabase] = await Promise.all([
    getCurrentKingUser(),
    createAuthenticatedSupabaseServerClient(),
  ]);

  if (!currentUser || !supabase) {
    return null;
  }

  const { data, error } = await supabase
    .rpc("get_current_platform_admin_context")
    .maybeSingle<PlatformAdminContextRow>();

  if (error) {
    console.error("Supabase resolve platform admin context failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      userId: currentUser.id,
    });
    return null;
  }

  return data ? mapPlatformAdminContextRow(data) : null;
}

export async function requirePlatformAdmin(
  permission: PlatformAdminPermission = PLATFORM_ADMIN_PERMISSIONS.access,
  options: { loginNextPath?: string } = {},
) {
  const authUser = await getSupabaseAuthUser();

  if (!authUser) {
    redirect(loginHrefForReturnPath(options.loginNextPath ?? "/admin"));
  }

  const context = await getCurrentPlatformAdminContext();

  if (!context || !context.permissions.includes(permission)) {
    notFound();
  }

  return context;
}
