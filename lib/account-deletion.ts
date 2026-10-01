import "server-only";

import {
  getAccountDeletionState,
  type AccountDeletionState,
} from "@/lib/salon-lifecycle";
import { listAccountDeletionRetentionPolicy } from "@/lib/account-retention-policy";
import {
  normalizeSalonLifecycleStatus,
  type SalonLifecycleStatus,
} from "@/lib/salon-lifecycle-rules";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type { KingUser } from "@/types/user";

export const ACCOUNT_DELETION_GRACE_DAYS = 30;

const LOCATION_OWNERSHIP_SELECT =
  "id, account_id, name, status, disabled_at, closed_at, created_at, updated_at";

type SupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

type RoleRow = {
  code: string;
  id: string;
};

type AccountMembershipRow = {
  account_id: string;
  id: string;
  role_id: string | null;
  status: string;
  user_id: string;
};

type SalonMembershipRow = {
  account_id: string;
  id: string;
  role_id: string | null;
  salon_id: string;
  status: string;
  user_id: string;
};

type OwnedSalonRow = {
  account_id: string | null;
  closed_at: string | null;
  created_at: string;
  disabled_at: string | null;
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

type ActiveOwnerCountRow = {
  active_owner_count: number | null;
  salon_id: string;
};

export type AccountDeletionImpactSalon = {
  accountId: string | null;
  closedAt: string | null;
  disabledAt: string | null;
  hasOtherOwner: boolean;
  id: string;
  isLastOwner: boolean;
  lifecycleStatus: SalonLifecycleStatus;
  name: string;
  ownedByAccountMembership: boolean;
  ownedBySalonMembership: boolean;
  requiresNoTransferClosure: boolean;
  status: string;
};

export type AccountDeletionImpact = {
  backupRecommended: boolean;
  canRequestDeletionWithoutTransfer: boolean;
  coOwnedSalons: AccountDeletionImpactSalon[];
  deletionState: AccountDeletionState;
  generatedAt: string;
  lastOwnerOperationalSalons: AccountDeletionImpactSalon[];
  lastOwnerSalons: AccountDeletionImpactSalon[];
  ownedSalons: AccountDeletionImpactSalon[];
  permanentlyClosedSalons: AccountDeletionImpactSalon[];
  transferRequiredSalonCount: number;
  user: Pick<
    KingUser,
    "deletion_requested_at" | "deletion_scheduled_for" | "display_name" | "email" | "id" | "status"
  >;
};

export type AccountDeletionBackup = {
  generatedAt: string;
  impact: Omit<AccountDeletionImpact, "user">;
  note: string;
  retentionPolicy: ReturnType<typeof listAccountDeletionRetentionPolicy>;
  user: {
    displayName: string | null;
    email: string | null;
    id: string;
    status: string;
  };
  version: 1;
};

function isOwnerRole(role: RoleRow | null | undefined) {
  return role?.code?.toUpperCase() === "OWNER";
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

async function requireCurrentUserAndSupabase() {
  const [supabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
  ]);

  if (!supabase || !user) {
    throw new Error("Sign in before managing account deletion.");
  }

  return { supabase, user };
}

async function loadRolesById(supabase: SupabaseClient, roleIds: string[]) {
  const uniqueRoleIds = unique(roleIds.filter(Boolean));

  if (uniqueRoleIds.length === 0) {
    return new Map<string, RoleRow>();
  }

  const { data, error } = await supabase
    .from("roles")
    .select("id, code")
    .in("id", uniqueRoleIds)
    .returns<RoleRow[]>();

  if (error) {
    console.error("Supabase account deletion role load failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((role) => [role.id, role]));
}

function ownerRoleIdsFrom(rolesById: Map<string, RoleRow>) {
  return new Set(
    [...rolesById.values()]
      .filter((role) => isOwnerRole(role))
      .map((role) => role.id),
  );
}

async function loadCurrentOwnerMemberships(input: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const [accountMembershipResult, salonMembershipResult] = await Promise.all([
    input.supabase
      .from("account_memberships")
      .select("id, account_id, user_id, role_id, status")
      .eq("user_id", input.userId)
      .eq("status", "active")
      .returns<AccountMembershipRow[]>(),
    input.supabase
      .from("salon_memberships")
      .select("id, account_id, salon_id, user_id, role_id, status")
      .eq("user_id", input.userId)
      .eq("status", "active")
      .returns<SalonMembershipRow[]>(),
  ]);

  if (accountMembershipResult.error) {
    console.error("Supabase account deletion account memberships failed", {
      code: accountMembershipResult.error.code,
      details: accountMembershipResult.error.details,
      hint: accountMembershipResult.error.hint,
      message: accountMembershipResult.error.message,
      userId: input.userId,
    });
    throw new Error(accountMembershipResult.error.message);
  }

  if (salonMembershipResult.error) {
    console.error("Supabase account deletion salon memberships failed", {
      code: salonMembershipResult.error.code,
      details: salonMembershipResult.error.details,
      hint: salonMembershipResult.error.hint,
      message: salonMembershipResult.error.message,
      userId: input.userId,
    });
    throw new Error(salonMembershipResult.error.message);
  }

  const roleIds = [
    ...(accountMembershipResult.data ?? []).map((membership) => membership.role_id),
    ...(salonMembershipResult.data ?? []).map((membership) => membership.role_id),
  ].filter((roleId): roleId is string => Boolean(roleId));
  const rolesById = await loadRolesById(input.supabase, roleIds);
  const ownerRoleIds = ownerRoleIdsFrom(rolesById);

  return {
    accountOwnerMemberships: (accountMembershipResult.data ?? []).filter(
      (membership) =>
        Boolean(membership.role_id) && ownerRoleIds.has(membership.role_id ?? ""),
    ),
    salonOwnerMemberships: (salonMembershipResult.data ?? []).filter(
      (membership) =>
        Boolean(membership.role_id) && ownerRoleIds.has(membership.role_id ?? ""),
    ),
  };
}

async function loadOwnedSalons(input: {
  accountIds: string[];
  salonIds: string[];
  supabase: SupabaseClient;
}) {
  const [accountSalonResult, directSalonResult] = await Promise.all([
    input.accountIds.length > 0
      ? input.supabase
          .from("locations")
          .select(LOCATION_OWNERSHIP_SELECT)
          .in("account_id", input.accountIds)
          .returns<OwnedSalonRow[]>()
      : { data: [] as OwnedSalonRow[], error: null },
    input.salonIds.length > 0
      ? input.supabase
          .from("locations")
          .select(LOCATION_OWNERSHIP_SELECT)
          .in("id", input.salonIds)
          .returns<OwnedSalonRow[]>()
      : { data: [] as OwnedSalonRow[], error: null },
  ]);

  if (accountSalonResult.error) {
    console.error("Supabase account deletion account salons failed", {
      accountIds: input.accountIds,
      code: accountSalonResult.error.code,
      details: accountSalonResult.error.details,
      hint: accountSalonResult.error.hint,
      message: accountSalonResult.error.message,
    });
    throw new Error(accountSalonResult.error.message);
  }

  if (directSalonResult.error) {
    console.error("Supabase account deletion direct salons failed", {
      code: directSalonResult.error.code,
      details: directSalonResult.error.details,
      hint: directSalonResult.error.hint,
      message: directSalonResult.error.message,
      salonIds: input.salonIds,
    });
    throw new Error(directSalonResult.error.message);
  }

  const salonsById = new Map<string, OwnedSalonRow>();

  for (const salon of [
    ...(accountSalonResult.data ?? []),
    ...(directSalonResult.data ?? []),
  ]) {
    salonsById.set(salon.id, salon);
  }

  return [...salonsById.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

async function loadActiveOwnerCountsForSalons(input: {
  salonIds: string[];
  supabase: SupabaseClient;
}) {
  const salonIds = unique(input.salonIds.filter(Boolean));

  if (salonIds.length === 0) {
    return new Map<string, number>();
  }

  const { data, error } = await input.supabase.rpc(
    "get_account_deletion_owner_counts",
    { p_salon_ids: salonIds },
  );

  if (error) {
    console.error("Supabase account deletion owner counts failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonIds,
    });
    throw new Error(error.message);
  }

  return new Map(
    ((data ?? []) as ActiveOwnerCountRow[]).map((row) => [
      row.salon_id,
      Number(row.active_owner_count ?? 0),
    ]),
  );
}

export async function analyzeAccountDeletionImpact(): Promise<AccountDeletionImpact> {
  const { supabase, user } = await requireCurrentUserAndSupabase();
  const { accountOwnerMemberships, salonOwnerMemberships } =
    await loadCurrentOwnerMemberships({
      supabase,
      userId: user.id,
    });
  const accountIds = unique(
    accountOwnerMemberships.map((membership) => membership.account_id),
  );
  const directlyOwnedSalonIds = unique(
    salonOwnerMemberships.map((membership) => membership.salon_id),
  );
  const ownedSalons = await loadOwnedSalons({
    accountIds,
    salonIds: directlyOwnedSalonIds,
    supabase,
  });
  const ownedSalonIds = ownedSalons.map((salon) => salon.id);
  const activeOwnerCounts = await loadActiveOwnerCountsForSalons({
    salonIds: ownedSalonIds,
    supabase,
  });
  const directlyOwnedSalonIdSet = new Set(directlyOwnedSalonIds);
  const accountOwnedAccountIdSet = new Set(accountIds);
  const impactSalons = ownedSalons.map((salon): AccountDeletionImpactSalon => {
    const activeOwnerCount = activeOwnerCounts.get(salon.id);

    if (activeOwnerCount == null) {
      throw new Error(`Unable to verify active owner count for salon ${salon.id}.`);
    }

    const lifecycleStatus = normalizeSalonLifecycleStatus(salon.status);
    const currentUserCountsAsActiveOwner = user.status === "active";
    const hasOtherOwner = activeOwnerCount > (currentUserCountsAsActiveOwner ? 1 : 0);
    const isLastOwner = !hasOtherOwner;

    return {
      accountId: salon.account_id,
      closedAt: salon.closed_at,
      disabledAt: salon.disabled_at,
      hasOtherOwner,
      id: salon.id,
      isLastOwner,
      lifecycleStatus,
      name: salon.name,
      ownedByAccountMembership:
        Boolean(salon.account_id) && accountOwnedAccountIdSet.has(salon.account_id ?? ""),
      ownedBySalonMembership: directlyOwnedSalonIdSet.has(salon.id),
      requiresNoTransferClosure:
        isLastOwner && lifecycleStatus !== "permanently_closed",
      status: salon.status,
    };
  });
  const lastOwnerSalons = impactSalons.filter((salon) => salon.isLastOwner);
  const lastOwnerOperationalSalons = lastOwnerSalons.filter(
    (salon) => salon.lifecycleStatus !== "permanently_closed",
  );

  return {
    backupRecommended: impactSalons.length > 0,
    canRequestDeletionWithoutTransfer: lastOwnerOperationalSalons.length === 0,
    coOwnedSalons: impactSalons.filter((salon) => salon.hasOtherOwner),
    deletionState: getAccountDeletionState(user),
    generatedAt: new Date().toISOString(),
    lastOwnerOperationalSalons,
    lastOwnerSalons,
    ownedSalons: impactSalons,
    permanentlyClosedSalons: impactSalons.filter(
      (salon) => salon.lifecycleStatus === "permanently_closed",
    ),
    transferRequiredSalonCount: lastOwnerOperationalSalons.length,
    user: {
      deletion_requested_at: user.deletion_requested_at ?? null,
      deletion_scheduled_for: user.deletion_scheduled_for ?? null,
      display_name: user.display_name,
      email: user.email,
      id: user.id,
      status: user.status,
    },
  };
}

export async function requestAccountDeletion(input: {
  backupAcknowledged: boolean;
  continueWithoutTransfer: boolean;
  reason?: string | null;
}) {
  const { supabase } = await requireCurrentUserAndSupabase();
  const { data, error } = await supabase.rpc("request_account_deletion", {
    p_backup_acknowledged: input.backupAcknowledged,
    p_continue_without_transfer: input.continueWithoutTransfer,
    p_reason: input.reason ?? null,
  });

  if (error) {
    console.error("Supabase request account deletion failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    throw new Error(error.message);
  }

  return data;
}

export async function cancelAccountDeletion() {
  const { supabase } = await requireCurrentUserAndSupabase();
  const { data, error } = await supabase.rpc("cancel_account_deletion");

  if (error) {
    console.error("Supabase cancel account deletion failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    throw new Error(error.message);
  }

  return data;
}

export async function generateAccountDeletionBackup(): Promise<AccountDeletionBackup> {
  const impact = await analyzeAccountDeletionImpact();

  return {
    generatedAt: new Date().toISOString(),
    impact: {
      backupRecommended: impact.backupRecommended,
      canRequestDeletionWithoutTransfer: impact.canRequestDeletionWithoutTransfer,
      coOwnedSalons: impact.coOwnedSalons,
      deletionState: impact.deletionState,
      generatedAt: impact.generatedAt,
      lastOwnerOperationalSalons: impact.lastOwnerOperationalSalons,
      lastOwnerSalons: impact.lastOwnerSalons,
      ownedSalons: impact.ownedSalons,
      permanentlyClosedSalons: impact.permanentlyClosedSalons,
      transferRequiredSalonCount: impact.transferRequiredSalonCount,
    },
    note: "Lightweight account deletion summary. Full private archives are generated through the lifecycle export service.",
    retentionPolicy: listAccountDeletionRetentionPolicy(),
    user: {
      displayName: impact.user.display_name,
      email: impact.user.email,
      id: impact.user.id,
      status: impact.user.status,
    },
    version: 1,
  };
}
