import "server-only";

import { routes } from "@/lib/routes";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type { Account, AccountMembership } from "@/types/account";
import type { Business } from "@/types/business";
import type { Location } from "@/types/location";
import type { Role } from "@/types/role";
import type { SalonMembership } from "@/types/salon-membership";
import type { KingUser } from "@/types/user";
import { cookies } from "next/headers";

export const CURRENT_ACCOUNT_COOKIE = "kingpos-current-account-id";
export const LEGACY_CURRENT_SALON_COOKIE = "kingpos-current-salon-id";
export const CURRENT_MANAGE_SALON_COOKIE = "kingpos-current-manage-salon-id";
export const CURRENT_STAFF_SALON_COOKIE = "kingpos-current-staff-salon-id";
export const SELECTED_WORKSPACE_COOKIE = "kingpos-selected-workspace";

export const CURRENT_SALON_COOKIE = CURRENT_MANAGE_SALON_COOKIE;

export const ACCOUNT_SELECT = "id, name, status, created_at, updated_at";
export const LOCATION_SELECT =
  "id, account_id, name, phone, address_line1, address_line2, city, state, postal_code, country, latitude, longitude, status, created_at, updated_at";
export const ROLE_SELECT =
  "id, account_id, name, code, description, is_system, created_at, updated_at";

const ROLE_PERMISSION_SELECT = "id, role_id, permission_id, created_at";
const PERMISSION_SELECT = "id, code";

export type WorkspaceType = "account" | "personal" | "salon";
export type SalonMode = "manage" | "staff";

export type CurrentWorkspaceAction = {
  href: string;
  id: string;
  label: string;
};

export type CurrentWorkspaceOption = {
  accountId: string | null;
  accountName: string | null;
  businessId: string | null;
  businessMode: SalonMode | null;
  businessName: string | null;
  defaultHref: string;
  description: string | null;
  id: string;
  label: string;
  menuActions: CurrentWorkspaceAction[];
  primaryAction: CurrentWorkspaceAction | null;
  quickActions: CurrentWorkspaceAction[];
  roleCode: string | null;
  roleLabel: string;
  salonCount: number | null;
  salonId: string | null;
  salonMode: SalonMode | null;
  salonName: string | null;
  secondaryAction: CurrentWorkspaceAction | null;
  type: WorkspaceType;
};

export type CurrentActiveRole = {
  accountRole: string | null;
  code: string | null;
  label: string;
  salonMode: SalonMode | null;
  type: WorkspaceType;
  workspaceId: string;
};

export type AccountMembershipWithAccount = AccountMembership & {
  account: Account | null;
  role: Role | null;
};

export type SalonMembershipWithSalon = SalonMembership & {
  account: Account | null;
  salon: Business | null;
};

export type CurrentMembership =
  | AccountMembershipWithAccount
  | SalonMembershipWithSalon;

export type CurrentBusinessContext = {
  accountId: string | null;
  accountMemberships: AccountMembershipWithAccount[];
  accountName: string | null;
  accountRole: string | null;
  activeRole: CurrentActiveRole | null;
  availableAccounts: Account[];
  availableBusinesses: Business[];
  availableManageSalons: Location[];
  availableStaffSalons: Location[];
  availableWorkspaceModes: SalonMode[];
  businessId: string | null;
  businessMode: SalonMode | null;
  businessName: string | null;
  businesses: Business[];
  currentAccount: Account | null;
  currentBusiness: Business | null;
  currentMembership: CurrentMembership | null;
  currentSalon: Location | null;
  currentStaffSalon: Location | null;
  currentWorkspace: CurrentWorkspaceOption | null;
  defaultRouteForCurrentContext: string;
  permissionCodes: string[];
  permissions: string[];
  salonId: string | null;
  salonMemberships: SalonMembershipWithSalon[];
  salonMode: SalonMode | null;
  salonName: string | null;
  salonRole: string | null;
  salons: Location[];
  staffSalons: Location[];
  user: KingUser | null;
  workspaceOptions: CurrentWorkspaceOption[];
  workspaceType: WorkspaceType;
};

type CookieStore = Awaited<ReturnType<typeof cookies>>;

type PermissionRow = {
  code: string;
  id: string;
};

type RolePermissionRow = {
  id: string;
  permission_id: string;
  role_id: string;
};

type StaffContextSalonRow = {
  id: string;
  salon_id: string;
};

function isMissingAccountSalonSchemaError(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined) {
  const message = error?.message ?? "";

  return (
    (error?.code === "PGRST205" &&
      /\b(accounts|account_memberships|salon_memberships)\b/.test(message)) ||
    (error?.code === "42703" &&
      /\b(account_id|account_user_id)\b/.test(message))
  );
}

export function getPersonalWorkspaceId() {
  return "personal";
}

export function getAccountWorkspaceId(accountId: string) {
  return `account:${accountId}`;
}

export function getManageWorkspaceId(salonId: string) {
  return `manage:${salonId}`;
}

export function getStaffWorkspaceId(salonId: string) {
  return `staff:${salonId}`;
}

export function isOwnerMembership(membership: CurrentMembership | null) {
  const code = membership?.role?.code?.toUpperCase() ?? null;
  const name = membership?.role?.name?.toLowerCase() ?? null;

  return code === "OWNER" || name === "owner";
}

function emptyContext(user: KingUser | null): CurrentBusinessContext {
  return {
    accountId: null,
    accountMemberships: [],
    accountName: null,
    accountRole: null,
    activeRole: null,
    availableAccounts: [],
    availableBusinesses: [],
    availableManageSalons: [],
    availableStaffSalons: [],
    availableWorkspaceModes: [],
    businessId: null,
    businessMode: null,
    businessName: null,
    businesses: [],
    currentAccount: null,
    currentBusiness: null,
    currentMembership: null,
    currentSalon: null,
    currentStaffSalon: null,
    currentWorkspace: null,
    defaultRouteForCurrentContext: "/explore",
    permissionCodes: [],
    permissions: [],
    salonId: null,
    salonMemberships: [],
    salonMode: null,
    salonName: null,
    salonRole: null,
    salons: [],
    staffSalons: [],
    user,
    workspaceOptions: [],
    workspaceType: "personal",
  };
}

function roleLabelForMembership(membership: CurrentMembership | null) {
  if (!membership) {
    return "Member";
  }

  return isOwnerMembership(membership) ? "Owner" : (membership.role?.name ?? "Manager");
}

function roleCodeForMembership(membership: CurrentMembership | null) {
  return membership?.role?.code ?? null;
}

function personalAccountNameForUser(user: KingUser) {
  const displayName = user.display_name?.trim();
  const emailPrefix = user.email?.split("@")[0]?.trim();
  const label = displayName || emailPrefix || "Personal";

  return `${label}'s Account`;
}

export function getCreateSalonAccount(context: CurrentBusinessContext) {
  const currentOwnerAccountMembership = context.accountMemberships.find(
    (membership) =>
      membership.account_id === context.accountId &&
      membership.account?.status === "active" &&
      isOwnerMembership(membership),
  );
  const fallbackOwnerAccountMembership = context.accountMemberships.find(
    (membership) =>
      membership.account?.status === "active" && isOwnerMembership(membership),
  );

  return (
    currentOwnerAccountMembership?.account ??
    fallbackOwnerAccountMembership?.account ??
    null
  );
}

function workspaceAction(
  id: string,
  label: string,
  href: string,
): CurrentWorkspaceAction {
  return { href, id, label };
}

function canUseManageAction(
  permissionCodes: Set<string>,
  isOwner: boolean,
  requiredPermissions: string | string[],
) {
  if (isOwner || permissionCodes.has("*")) {
    return true;
  }

  const permissions = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];

  return permissions.some((permission) => permissionCodes.has(permission));
}

function buildManageWorkspaceActions(input: {
  defaultHref: string;
  isOwner: boolean;
  permissionCodes: Set<string>;
}) {
  const actions: CurrentWorkspaceAction[] = [];

  if (canUseManageAction(input.permissionCodes, input.isOwner, "staff.view")) {
    actions.push(workspaceAction("today", "Today", "/staff/today"));
  }

  if (canUseManageAction(input.permissionCodes, input.isOwner, "booking.view")) {
    actions.push(workspaceAction("book", "Book", "/bookings"));
  }

  if (
    canUseManageAction(
      input.permissionCodes,
      input.isOwner,
      "salon_profile.view",
    )
  ) {
    actions.push(workspaceAction("profile", "Profile", "/salon-profile"));
  }

  if (canUseManageAction(input.permissionCodes, input.isOwner, "tickets.manage")) {
    actions.push(workspaceAction("pos", "POS", "/pos/portable"));
  }

  if (canUseManageAction(input.permissionCodes, input.isOwner, "staff.view")) {
    actions.push(workspaceAction("staff", "Staff", "/staff"));
  }

  if (
    canUseManageAction(input.permissionCodes, input.isOwner, [
      "payroll.view",
      "payroll.manage",
    ])
  ) {
    actions.push(workspaceAction("payroll", "Payroll", "/payroll"));
  }

  if (canUseManageAction(input.permissionCodes, input.isOwner, "reports.view")) {
    actions.push(workspaceAction("reports", "Reports", "/reports"));
  }

  if (canUseManageAction(input.permissionCodes, input.isOwner, "customers.view")) {
    actions.push(workspaceAction("customers", "Customers", "/customers"));
  }

  if (canUseManageAction(input.permissionCodes, input.isOwner, "services.view")) {
    actions.push(workspaceAction("services", "Services", "/services"));
  }

  if (
    canUseManageAction(
      input.permissionCodes,
      input.isOwner,
      "salon_settings.view",
    )
  ) {
    actions.push(
      workspaceAction("salon-settings", "Salon Settings", "/salon-settings"),
    );
  }

  const defaultAction =
    actions.find((action) => action.href === input.defaultHref) ??
    actions[0] ??
    null;
  const primaryAction = defaultAction
    ? workspaceAction("open", "Open", defaultAction.href)
    : null;
  const secondaryAction = defaultAction
    ? workspaceAction("open", "Open", defaultAction.href)
    : null;

  return {
    menuActions: actions.filter((action) => action.id !== primaryAction?.id),
    primaryAction,
    quickActions: actions,
    secondaryAction,
  };
}

function buildStaffWorkspaceActions() {
  const today = workspaceAction("today", "Today", "/staff/my-work");
  const schedule = workspaceAction("schedule", "Schedule", "/staff/appointments");
  const post = workspaceAction("post", "Post", "/salon-profile");
  const payroll = workspaceAction("payroll", "Payroll", "/staff/my-work?tab=payroll");
  const statistics = workspaceAction(
    "statistics",
    "Statistics",
    "/staff/my-work?tab=analysis",
  );

  return {
    menuActions: [payroll, statistics],
    primaryAction: today,
    quickActions: [today, schedule, post],
    secondaryAction: workspaceAction("open", "Open", "/staff/my-work"),
  };
}

function buildAccountWorkspaceActions(input: { isOwner: boolean }) {
  const overview = workspaceAction("overview", "Salons", routes.salons.list());
  const actions = [overview];

  if (input.isOwner) {
    actions.push(
      workspaceAction("create-salon", "Create Salon", routes.salons.create()),
      workspaceAction("members", "Members", "/roles"),
      workspaceAction("settings", "Permissions", "/permissions"),
    );
  }

  return {
    menuActions: actions.filter((action) => action.id !== "overview"),
    primaryAction: overview,
    quickActions: actions,
    secondaryAction: null,
  };
}

function buildActiveRole(
  currentWorkspace: CurrentWorkspaceOption | null,
  accountRole: string | null,
): CurrentActiveRole | null {
  if (!currentWorkspace) {
    return null;
  }

  return {
    accountRole,
    code: currentWorkspace.roleCode,
    label: currentWorkspace.roleLabel,
    salonMode: currentWorkspace.salonMode,
    type: currentWorkspace.type,
    workspaceId: currentWorkspace.id,
  };
}

function groupSalonsByAccount(salons: Location[]) {
  const salonsByAccount = new Map<string, Location[]>();

  for (const salon of salons) {
    if (!salon.account_id) {
      continue;
    }

    const accountSalons = salonsByAccount.get(salon.account_id) ?? [];
    accountSalons.push(salon);
    salonsByAccount.set(salon.account_id, accountSalons);
  }

  return salonsByAccount;
}

function buildPersonalWorkspaceOption(): CurrentWorkspaceOption {
  const explore = workspaceAction("explore", "Explore", "/explore");
  const bookings = workspaceAction("bookings", "Bookings", "/my-bookings");
  const beauty = workspaceAction("beauty", "Beauty", "/beauty");
  const notifications = workspaceAction(
    "notifications",
    "Notifications",
    "/notifications",
  );
  const more = workspaceAction("more", "More", "/more");
  const settings = workspaceAction("settings", "Account Settings", "/settings");

  return {
    accountId: null,
    accountName: null,
    businessId: null,
    businessMode: null,
    businessName: null,
    defaultHref: "/explore",
    description: "Explore, bookings, beauty timeline, and account settings.",
    id: getPersonalWorkspaceId(),
    label: "Personal account",
    menuActions: [more, settings],
    primaryAction: explore,
    quickActions: [explore, bookings, beauty, notifications],
    roleCode: null,
    roleLabel: "Personal",
    salonCount: null,
    salonId: null,
    salonMode: null,
    salonName: null,
    secondaryAction: notifications,
    type: "personal",
  };
}

function buildAccountWorkspaceOption(input: {
  membership: AccountMembershipWithAccount;
  salonCount: number | null;
}): CurrentWorkspaceOption | null {
  const account = input.membership.account;

  if (!account) {
    return null;
  }

  const actionSet = buildAccountWorkspaceActions({
    isOwner: isOwnerMembership(input.membership),
  });

  return {
    accountId: account.id,
    accountName: account.name,
    businessId: null,
    businessMode: null,
    businessName: null,
    defaultHref: routes.salons.list(),
    description: null,
    id: getAccountWorkspaceId(account.id),
    label: account.name,
    menuActions: actionSet.menuActions,
    primaryAction: actionSet.primaryAction,
    quickActions: actionSet.quickActions,
    roleCode: roleCodeForMembership(input.membership),
    roleLabel: roleLabelForMembership(input.membership),
    salonCount: input.salonCount,
    salonId: null,
    salonMode: null,
    salonName: null,
    secondaryAction: actionSet.secondaryAction,
    type: "account",
  };
}

function getManageDefaultRoute(permissionCodes: Set<string>, isOwner: boolean) {
  if (isOwner || permissionCodes.has("staff.view")) {
    return "/staff/today";
  }

  if (permissionCodes.has("booking.view")) {
    return "/bookings";
  }

  if (permissionCodes.has("tickets.manage")) {
    return "/pos/portable";
  }

  if (permissionCodes.has("customers.view")) {
    return "/customers";
  }

  if (permissionCodes.has("services.view")) {
    return "/services";
  }

  if (permissionCodes.has("salon_profile.view")) {
    return "/salon-profile";
  }

  if (permissionCodes.has("payroll.view") || permissionCodes.has("payroll.manage")) {
    return "/payroll";
  }

  if (permissionCodes.has("reports.view")) {
    return "/reports";
  }

  if (permissionCodes.has("salon_settings.view")) {
    return "/salon-settings";
  }

  return "/my-place";
}

function buildManageWorkspaceOption(input: {
  account: Account;
  membership: CurrentMembership;
  permissionCodes: Set<string>;
  salon: Location;
}): CurrentWorkspaceOption {
  const isOwner = isOwnerMembership(input.membership);
  const defaultHref = getManageDefaultRoute(input.permissionCodes, isOwner);
  const actionSet = buildManageWorkspaceActions({
    defaultHref,
    isOwner,
    permissionCodes: input.permissionCodes,
  });

  return {
    accountId: input.account.id,
    accountName: input.account.name,
    businessId: input.salon.id,
    businessMode: "manage",
    businessName: input.salon.name,
    defaultHref,
    description: input.account.name,
    id: getManageWorkspaceId(input.salon.id),
    label: input.salon.name,
    menuActions: actionSet.menuActions,
    primaryAction: actionSet.primaryAction,
    quickActions: actionSet.quickActions,
    roleCode: roleCodeForMembership(input.membership),
    roleLabel: roleLabelForMembership(input.membership),
    salonCount: null,
    salonId: input.salon.id,
    salonMode: "manage",
    salonName: input.salon.name,
    secondaryAction: actionSet.secondaryAction,
    type: "salon",
  };
}

function buildStaffWorkspaceOption(input: {
  account: Account | null;
  salon: Location;
}): CurrentWorkspaceOption {
  const actionSet = buildStaffWorkspaceActions();

  return {
    accountId: input.account?.id ?? input.salon.account_id ?? null,
    accountName: input.account?.name ?? null,
    businessId: input.salon.id,
    businessMode: "staff",
    businessName: input.salon.name,
    defaultHref: "/staff/my-work",
    description: input.salon.city ?? input.account?.name ?? "Staff workspace",
    id: getStaffWorkspaceId(input.salon.id),
    label: input.salon.name,
    menuActions: actionSet.menuActions,
    primaryAction: actionSet.primaryAction,
    quickActions: actionSet.quickActions,
    roleCode: "STAFF",
    roleLabel: "Staff",
    salonCount: null,
    salonId: input.salon.id,
    salonMode: "staff",
    salonName: input.salon.name,
    secondaryAction: actionSet.secondaryAction,
    type: "salon",
  };
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const deduped = new Map<string, T>();

  for (const item of items) {
    deduped.set(item.id, item);
  }

  return [...deduped.values()];
}

function dedupeWorkspaces(workspaces: CurrentWorkspaceOption[]) {
  return dedupeById(workspaces);
}

function permissionArray(permissionCodes: Set<string>) {
  return [...permissionCodes].sort((left, right) => left.localeCompare(right));
}

async function loadPermissionCodesForMembership(
  membership: CurrentMembership | null,
) {
  if (!membership?.role_id) {
    return new Set<string>();
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return new Set<string>();
  }

  const { data: rolePermissions, error: rolePermissionsError } = await supabase
    .from("role_permissions")
    .select(ROLE_PERMISSION_SELECT)
    .eq("role_id", membership.role_id)
    .returns<RolePermissionRow[]>();

  if (rolePermissionsError) {
    console.error("Supabase load role permission ids failed", {
      code: rolePermissionsError.code,
      details: rolePermissionsError.details,
      hint: rolePermissionsError.hint,
      message: rolePermissionsError.message,
      roleId: membership.role_id,
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
    .returns<PermissionRow[]>();

  if (permissionsError) {
    console.error("Supabase load permission codes failed", {
      code: permissionsError.code,
      details: permissionsError.details,
      hint: permissionsError.hint,
      message: permissionsError.message,
      roleId: membership.role_id,
    });
    throw new Error(permissionsError.message);
  }

  return new Set((permissions ?? []).map((permission) => permission.code));
}

async function loadCurrentMemberships() {
  const user = await getCurrentKingUser();

  if (!user) {
    return {
      accountMemberships: [] as AccountMembershipWithAccount[],
      salonMemberships: [] as SalonMembershipWithSalon[],
      user,
    };
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return {
      accountMemberships: [] as AccountMembershipWithAccount[],
      salonMemberships: [] as SalonMembershipWithSalon[],
      user,
    };
  }

  const { error: accountBootstrapError } = await supabase.rpc(
    "ensure_personal_account_for_current_user",
    {
      p_account_name: personalAccountNameForUser(user),
    },
  );

  if (accountBootstrapError) {
    console.error("Supabase ensure personal account failed", {
      code: accountBootstrapError.code,
      details: accountBootstrapError.details,
      hint: accountBootstrapError.hint,
      message: accountBootstrapError.message,
      userId: user.id,
    });
    throw new Error(accountBootstrapError.message);
  }

  type AccountMembershipRow = AccountMembership;
  type SalonMembershipRow = Omit<SalonMembership, "role">;

  const [accountMembershipResult, salonMembershipResult] = await Promise.all([
    supabase
      .from("account_memberships")
      .select(
        "id, account_id, user_id, role_id, status, joined_at, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .returns<AccountMembershipRow[]>(),
    supabase
      .from("salon_memberships")
      .select(
        "id, account_id, salon_id, user_id, role_id, status, joined_at, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .returns<SalonMembershipRow[]>(),
  ]);

  const accountMembershipError = accountMembershipResult.error;
  const salonMembershipError = salonMembershipResult.error;

  if (isMissingAccountSalonSchemaError(accountMembershipError)) {
    console.warn("Account/Salon database schema is not applied.", {
      code: accountMembershipError?.code,
      message: accountMembershipError?.message,
      missing: "account_memberships",
      userId: user.id,
    });
    return {
      accountMemberships: [] as AccountMembershipWithAccount[],
      salonMemberships: [] as SalonMembershipWithSalon[],
      user,
    };
  }

  if (accountMembershipError) {
    console.error("Supabase load account memberships failed", {
      code: accountMembershipError.code,
      details: accountMembershipError.details,
      hint: accountMembershipError.hint,
      message: accountMembershipError.message,
      userId: user.id,
    });
    throw new Error(accountMembershipError.message);
  }

  if (isMissingAccountSalonSchemaError(salonMembershipError)) {
    console.warn("Account/Salon database schema is not applied.", {
      code: salonMembershipError?.code,
      message: salonMembershipError?.message,
      missing: "salon_memberships",
      userId: user.id,
    });
    return {
      accountMemberships: [] as AccountMembershipWithAccount[],
      salonMemberships: [] as SalonMembershipWithSalon[],
      user,
    };
  }

  if (salonMembershipError) {
    console.error("Supabase load salon memberships failed", {
      code: salonMembershipError.code,
      details: salonMembershipError.details,
      hint: salonMembershipError.hint,
      message: salonMembershipError.message,
      userId: user.id,
    });
    throw new Error(salonMembershipError.message);
  }

  const accountMembershipRows = accountMembershipResult.data ?? [];
  const salonMembershipRows = salonMembershipResult.data ?? [];
  const accountIds = [
    ...new Set(
      [...accountMembershipRows, ...salonMembershipRows].map(
        (membership) => membership.account_id,
      ),
    ),
  ];
  const roleIds = [
    ...new Set(
      [...accountMembershipRows, ...salonMembershipRows]
        .map((membership) => membership.role_id)
        .filter((roleId): roleId is string => Boolean(roleId)),
    ),
  ];
  const salonIds = [
    ...new Set(salonMembershipRows.map((membership) => membership.salon_id)),
  ];

  const [accountsResult, rolesResult, salonsResult] = await Promise.all([
    accountIds.length > 0
      ? supabase
          .from("accounts")
          .select(ACCOUNT_SELECT)
          .in("id", accountIds)
          .returns<Account[]>()
      : { data: [] as Account[], error: null },
    roleIds.length > 0
      ? supabase
          .from("roles")
          .select(ROLE_SELECT)
          .in("id", roleIds)
          .returns<Role[]>()
      : { data: [] as Role[], error: null },
    salonIds.length > 0
      ? supabase
          .from("locations")
          .select(LOCATION_SELECT)
          .in("id", salonIds)
          .returns<Business[]>()
      : { data: [] as Business[], error: null },
  ]);

  if (accountsResult.error) {
    console.error("Supabase hydrate membership accounts failed", {
      accountIds,
      code: accountsResult.error.code,
      details: accountsResult.error.details,
      hint: accountsResult.error.hint,
      message: accountsResult.error.message,
      userId: user.id,
    });
    throw new Error(accountsResult.error.message);
  }

  if (rolesResult.error) {
    console.error("Supabase hydrate membership roles failed", {
      code: rolesResult.error.code,
      details: rolesResult.error.details,
      hint: rolesResult.error.hint,
      message: rolesResult.error.message,
      roleIds,
      userId: user.id,
    });
    throw new Error(rolesResult.error.message);
  }

  if (salonsResult.error) {
    console.error("Supabase hydrate membership salons failed", {
      code: salonsResult.error.code,
      details: salonsResult.error.details,
      hint: salonsResult.error.hint,
      message: salonsResult.error.message,
      salonIds,
      userId: user.id,
    });
    throw new Error(salonsResult.error.message);
  }

  const accountsById = new Map(
    (accountsResult.data ?? []).map((account) => [account.id, account]),
  );
  const rolesById = new Map((rolesResult.data ?? []).map((role) => [role.id, role]));
  const salonsById = new Map(
    (salonsResult.data ?? []).map((salon) => [salon.id, salon]),
  );

  return {
    accountMemberships: accountMembershipRows.map((membership) => ({
      ...membership,
      account: accountsById.get(membership.account_id) ?? null,
      role: membership.role_id ? (rolesById.get(membership.role_id) ?? null) : null,
    })),
    salonMemberships: salonMembershipRows.map((membership) => ({
      ...membership,
      account: accountsById.get(membership.account_id) ?? null,
      role: membership.role_id ? (rolesById.get(membership.role_id) ?? null) : null,
      salon: salonsById.get(membership.salon_id) ?? null,
    })),
    user,
  };
}

async function loadMissingAccounts(input: {
  accountsById: Map<string, Account>;
  accountIds: string[];
}) {
  const missingAccountIds = input.accountIds.filter(
    (accountId) => !input.accountsById.has(accountId),
  );

  if (missingAccountIds.length === 0) {
    return;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { data, error } = await supabase
    .from("accounts")
    .select(ACCOUNT_SELECT)
    .in("id", missingAccountIds)
    .returns<Account[]>();

  if (error) {
    console.error("Supabase load membership accounts failed", {
      accountIds: missingAccountIds,
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    throw new Error(error.message);
  }

  for (const account of data ?? []) {
    input.accountsById.set(account.id, account);
  }
}

async function loadStaffSalons(input: {
  accountsById: Map<string, Account>;
  user: KingUser;
}) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return {
      staffSalons: [] as Location[],
      workspaceOptions: [] as CurrentWorkspaceOption[],
    };
  }

  const { data: staffRows, error: staffError } = await supabase
    .from("staff")
    .select("id, salon_id")
    .eq("account_user_id", input.user.id)
    .eq("is_active", true)
    .returns<StaffContextSalonRow[]>();

  if (staffError) {
    if (isMissingAccountSalonSchemaError(staffError)) {
      console.warn("Account/Salon database schema is not applied.", {
        code: staffError.code,
        message: staffError.message,
        missing: "staff.account_user_id",
        userId: input.user.id,
      });
      return {
        staffSalons: [] as Location[],
        workspaceOptions: [] as CurrentWorkspaceOption[],
      };
    }

    console.error("Supabase load linked staff salons failed", {
      code: staffError.code,
      details: staffError.details,
      hint: staffError.hint,
      message: staffError.message,
      userId: input.user.id,
    });
    throw new Error(staffError.message);
  }

  const salonIds = [
    ...new Set(
      (staffRows ?? [])
        .map((row) => row.salon_id)
        .filter((salonId): salonId is string => Boolean(salonId)),
    ),
  ];

  if (salonIds.length === 0) {
    return {
      staffSalons: [] as Location[],
      workspaceOptions: [] as CurrentWorkspaceOption[],
    };
  }

  const { data: staffSalons, error: staffSalonsError } = await supabase
    .from("locations")
    .select(LOCATION_SELECT)
    .in("id", salonIds)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .returns<Location[]>();

  if (staffSalonsError) {
    if (isMissingAccountSalonSchemaError(staffSalonsError)) {
      console.warn("Account/Salon database schema is not applied.", {
        code: staffSalonsError.code,
        message: staffSalonsError.message,
        missing: "locations.account_id",
        salonIds,
        userId: input.user.id,
      });
      return {
        staffSalons: [] as Location[],
        workspaceOptions: [] as CurrentWorkspaceOption[],
      };
    }

    console.error("Supabase load staff salon records failed", {
      code: staffSalonsError.code,
      details: staffSalonsError.details,
      hint: staffSalonsError.hint,
      message: staffSalonsError.message,
      salonIds,
      userId: input.user.id,
    });
    throw new Error(staffSalonsError.message);
  }

  const salons = staffSalons ?? [];
  await loadMissingAccounts({
    accountIds: salons
      .map((salon) => salon.account_id)
      .filter((accountId): accountId is string => Boolean(accountId)),
    accountsById: input.accountsById,
  });

  return {
    staffSalons: salons,
    workspaceOptions: salons.map((salon) =>
      buildStaffWorkspaceOption({
        account: salon.account_id
          ? (input.accountsById.get(salon.account_id) ?? null)
          : null,
        salon,
      }),
    ),
  };
}

function getFallbackWorkspace(input: {
  accountOptions: CurrentWorkspaceOption[];
  manageOptions: CurrentWorkspaceOption[];
  personalWorkspace: CurrentWorkspaceOption;
  staffOptions: CurrentWorkspaceOption[];
}) {
  return (
    input.accountOptions[0] ??
    input.manageOptions[0] ??
    input.staffOptions[0] ??
    input.personalWorkspace
  );
}

function resolveWorkspaceFromCookie(input: {
  cookieStore: CookieStore;
  fallbackWorkspace: CurrentWorkspaceOption;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const storedWorkspaceId =
    input.cookieStore.get(SELECTED_WORKSPACE_COOKIE)?.value ?? null;

  if (storedWorkspaceId) {
    const storedWorkspace = input.workspaceOptions.find(
      (workspace) => workspace.id === storedWorkspaceId,
    );

    if (storedWorkspace) {
      return storedWorkspace;
    }
  }

  const storedManageSalonId =
    input.cookieStore.get(CURRENT_MANAGE_SALON_COOKIE)?.value ??
    input.cookieStore.get(LEGACY_CURRENT_SALON_COOKIE)?.value ??
    null;

  if (storedManageSalonId) {
    const storedSalonWorkspace = input.workspaceOptions.find(
      (workspace) =>
        workspace.salonMode === "manage" &&
        workspace.salonId === storedManageSalonId,
    );

    if (storedSalonWorkspace) {
      return storedSalonWorkspace;
    }
  }

  const storedStaffSalonId =
    input.cookieStore.get(CURRENT_STAFF_SALON_COOKIE)?.value ?? null;

  if (storedStaffSalonId) {
    const storedStaffWorkspace = input.workspaceOptions.find(
      (workspace) =>
        workspace.salonMode === "staff" &&
        workspace.salonId === storedStaffSalonId,
    );

    if (storedStaffWorkspace) {
      return storedStaffWorkspace;
    }
  }

  const storedAccountId =
    input.cookieStore.get(CURRENT_ACCOUNT_COOKIE)?.value ?? null;

  if (storedAccountId) {
    const storedAccountWorkspace = input.workspaceOptions.find(
      (workspace) =>
        workspace.type === "account" && workspace.accountId === storedAccountId,
    );

    if (storedAccountWorkspace) {
      return storedAccountWorkspace;
    }
  }

  return input.fallbackWorkspace;
}

function getModesForSalon(input: {
  salonId: string | null;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  if (!input.salonId) {
    return [];
  }

  return input.workspaceOptions
    .filter(
      (workspace) =>
        workspace.type === "salon" &&
        workspace.salonId === input.salonId &&
        workspace.salonMode,
    )
    .map((workspace) => workspace.salonMode)
    .filter((mode): mode is SalonMode => Boolean(mode));
}

function findAccountForWorkspace(input: {
  accountsById: Map<string, Account>;
  currentWorkspace: CurrentWorkspaceOption;
}) {
  return input.currentWorkspace.accountId
    ? (input.accountsById.get(input.currentWorkspace.accountId) ?? null)
    : null;
}

function findMembershipForWorkspace(input: {
  accountMembershipByAccountId: Map<string, AccountMembershipWithAccount>;
  currentWorkspace: CurrentWorkspaceOption;
  salonMembershipBySalonId: Map<string, SalonMembershipWithSalon>;
}) {
  if (input.currentWorkspace.type === "account" && input.currentWorkspace.accountId) {
    return (
      input.accountMembershipByAccountId.get(input.currentWorkspace.accountId) ?? null
    );
  }

  if (input.currentWorkspace.salonId) {
    const salonMembership = input.salonMembershipBySalonId.get(
      input.currentWorkspace.salonId,
    );

    if (salonMembership) {
      return salonMembership;
    }

    return input.currentWorkspace.accountId
      ? (input.accountMembershipByAccountId.get(input.currentWorkspace.accountId) ??
          null)
      : null;
  }

  return null;
}

export async function getCurrentStaffBusinessContext(): Promise<CurrentBusinessContext> {
  const context = await getCurrentBusinessContext();
  const staffWorkspaces = context.workspaceOptions.filter(
    (workspace) => workspace.salonMode === "staff",
  );

  if (!context.user || staffWorkspaces.length === 0) {
    return emptyContext(context.user);
  }

  const cookieStore = await cookies();
  const storedStaffSalonId =
    cookieStore.get(CURRENT_STAFF_SALON_COOKIE)?.value ??
    cookieStore.get(LEGACY_CURRENT_SALON_COOKIE)?.value ??
    null;
  const currentWorkspace =
    (storedStaffSalonId
      ? staffWorkspaces.find((workspace) => workspace.salonId === storedStaffSalonId)
      : null) ?? staffWorkspaces[0];
  const currentStaffSalon =
    context.staffSalons.find((salon) => salon.id === currentWorkspace.salonId) ??
    context.availableManageSalons.find(
      (salon) => salon.id === currentWorkspace.salonId,
    ) ??
    null;

  if (!currentStaffSalon) {
    return emptyContext(context.user);
  }

  const currentAccount = currentWorkspace.accountId
    ? (context.availableAccounts.find(
        (account) => account.id === currentWorkspace.accountId,
      ) ?? null)
    : null;
  const currentBusiness = currentStaffSalon as Business;

  return {
    ...context,
    accountId: currentWorkspace.accountId,
    accountName: currentWorkspace.accountName ?? currentAccount?.name ?? null,
    accountRole: null,
    activeRole: buildActiveRole(currentWorkspace, null),
    availableWorkspaceModes: ["staff"],
    businessId: currentBusiness.id,
    businessMode: "staff",
    businessName: currentBusiness.name,
    businesses: [currentBusiness],
    currentAccount,
    currentBusiness,
    currentMembership: findMembershipForWorkspace({
      accountMembershipByAccountId: new Map(
        context.accountMemberships.map((membership) => [
          membership.account_id,
          membership,
        ]),
      ),
      currentWorkspace,
      salonMembershipBySalonId: new Map(
        context.salonMemberships.map((membership) => [
          membership.salon_id,
          membership,
        ]),
      ),
    }),
    currentSalon: currentStaffSalon,
    currentStaffSalon,
    currentWorkspace,
    defaultRouteForCurrentContext: currentWorkspace.defaultHref,
    permissionCodes: [],
    permissions: [],
    salonId: currentStaffSalon.id,
    salonMode: "staff",
    salonName: currentStaffSalon.name,
    salonRole: "Staff",
    salons: [currentStaffSalon],
    workspaceType: "salon",
  };
}

export async function getCurrentBusinessContext(): Promise<CurrentBusinessContext> {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const { accountMemberships, salonMemberships, user } =
    await loadCurrentMemberships();

  if (!supabase || !user) {
    return emptyContext(user);
  }

  const cookieStore = await cookies();
  const accountsById = new Map<string, Account>();

  for (const membership of accountMemberships) {
    if (membership.account) {
      accountsById.set(membership.account.id, membership.account);
    }
  }

  await loadMissingAccounts({
    accountIds: salonMemberships.map((membership) => membership.account_id),
    accountsById,
  });

  const enrichedSalonMemberships = salonMemberships.map((membership) => ({
    ...membership,
    account: accountsById.get(membership.account_id) ?? null,
  }));
  const accounts = dedupeById([...accountsById.values()]);
  const accountMembershipByAccountId = new Map(
    accountMemberships.map((membership) => [membership.account_id, membership]),
  );
  const accountIds = accounts.map((account) => account.id);
  const accountSalonResult =
    accountIds.length > 0
      ? await supabase
          .from("locations")
          .select(LOCATION_SELECT)
          .in("account_id", accountIds)
          .order("created_at", { ascending: true })
          .returns<Location[]>()
      : { data: [] as Location[], error: null };

  if (accountSalonResult.error) {
    console.error("Supabase load account salons failed", {
      accountIds,
      code: accountSalonResult.error.code,
      details: accountSalonResult.error.details,
      hint: accountSalonResult.error.hint,
      message: accountSalonResult.error.message,
      userId: user.id,
    });
    throw new Error(accountSalonResult.error.message);
  }

  const memberSalons = enrichedSalonMemberships
    .map((membership) => membership.salon)
    .filter((salon): salon is Business => Boolean(salon));
  const allSalons = dedupeById([
    ...(accountSalonResult.data ?? []),
    ...memberSalons,
  ]);
  const allBusinesses = allSalons as Business[];
  const salonsByAccount = groupSalonsByAccount(allSalons);
  const staffLinkedContext = await loadStaffSalons({ accountsById, user });
  const personalWorkspace = buildPersonalWorkspaceOption();
  const accountOptions = accountMemberships
    .map((membership) =>
      buildAccountWorkspaceOption({
        membership,
        salonCount: membership.account
          ? (salonsByAccount.get(membership.account.id)?.length ?? 0)
          : null,
      }),
    )
    .filter(
      (workspace): workspace is CurrentWorkspaceOption => workspace !== null,
    );
  const permissionCodesByMembershipId = new Map<string, Set<string>>();

  for (const membership of [...accountMemberships, ...enrichedSalonMemberships]) {
    permissionCodesByMembershipId.set(
      membership.id,
      await loadPermissionCodesForMembership(membership),
    );
  }

  const salonMembershipBySalonId = new Map(
    enrichedSalonMemberships.map((membership) => [
      membership.salon_id,
      membership,
    ]),
  );
  const manageWorkspaceOptions = dedupeWorkspaces(
    allSalons.flatMap((salon) => {
      const account = salon.account_id
        ? (accountsById.get(salon.account_id) ?? null)
        : null;

      if (!account) {
        return [];
      }

      const membership =
        salonMembershipBySalonId.get(salon.id) ??
        accountMembershipByAccountId.get(account.id) ??
        null;

      if (!membership) {
        return [];
      }

      return [
        buildManageWorkspaceOption({
          account,
          membership,
          permissionCodes:
            permissionCodesByMembershipId.get(membership.id) ?? new Set<string>(),
          salon,
        }),
      ];
    }),
  );
  const workspaceOptions = dedupeWorkspaces([
    personalWorkspace,
    ...accountOptions,
    ...manageWorkspaceOptions,
    ...staffLinkedContext.workspaceOptions,
  ]);
  const fallbackWorkspace = getFallbackWorkspace({
    accountOptions,
    manageOptions: manageWorkspaceOptions,
    personalWorkspace,
    staffOptions: staffLinkedContext.workspaceOptions,
  });
  const currentWorkspace = resolveWorkspaceFromCookie({
    cookieStore,
    fallbackWorkspace,
    workspaceOptions,
  });
  const currentAccount = findAccountForWorkspace({
    accountsById,
    currentWorkspace,
  });
  const currentMembership = findMembershipForWorkspace({
    accountMembershipByAccountId,
    currentWorkspace,
    salonMembershipBySalonId,
  });
  const currentSalon =
    currentWorkspace.salonId && currentWorkspace.salonMode
      ? (allSalons.find((salon) => salon.id === currentWorkspace.salonId) ??
        staffLinkedContext.staffSalons.find(
          (salon) => salon.id === currentWorkspace.salonId,
        ) ??
        null)
      : null;
  const currentBusiness = currentSalon as Business | null;
  const permissionCodes =
    currentMembership && currentWorkspace.salonMode !== "staff"
      ? (permissionCodesByMembershipId.get(currentMembership.id) ?? new Set<string>())
      : new Set<string>();
  const activePermissions = permissionArray(permissionCodes);
  const accountRole =
    currentWorkspace.type === "account" || currentWorkspace.salonMode === "manage"
      ? roleLabelForMembership(currentMembership)
      : null;
  const accountSalons = currentAccount
    ? (salonsByAccount.get(currentAccount.id) ?? [])
    : [];

  return {
    accountId: currentWorkspace.accountId,
    accountMemberships,
    accountName: currentWorkspace.accountName,
    accountRole,
    activeRole: buildActiveRole(currentWorkspace, accountRole),
    availableAccounts: accounts,
    availableBusinesses: allBusinesses,
    availableManageSalons: allSalons,
    availableStaffSalons: staffLinkedContext.staffSalons,
    availableWorkspaceModes: getModesForSalon({
      salonId: currentWorkspace.salonId,
      workspaceOptions,
    }),
    businessId: currentBusiness?.id ?? null,
    businessMode: currentWorkspace.businessMode ?? currentWorkspace.salonMode,
    businessName: currentBusiness?.name ?? null,
    businesses:
      accountSalons.length > 0
        ? (accountSalons as Business[])
        : currentBusiness
          ? [currentBusiness]
          : allBusinesses,
    currentAccount,
    currentBusiness,
    currentMembership,
    currentSalon,
    currentStaffSalon: currentWorkspace.salonMode === "staff" ? currentSalon : null,
    currentWorkspace,
    defaultRouteForCurrentContext:
      currentWorkspace.type === "personal" ? "/explore" : currentWorkspace.defaultHref,
    permissionCodes: activePermissions,
    permissions: activePermissions,
    salonId: currentSalon?.id ?? null,
    salonMemberships: enrichedSalonMemberships,
    salonMode: currentWorkspace.salonMode,
    salonName: currentSalon?.name ?? null,
    salonRole: currentWorkspace.salonMode ? currentWorkspace.roleLabel : null,
    salons:
      accountSalons.length > 0
        ? accountSalons
        : currentSalon
          ? [currentSalon]
          : allSalons,
    staffSalons: staffLinkedContext.staffSalons,
    user,
    workspaceOptions,
    workspaceType: currentWorkspace.type,
  };
}

async function setPersistentCookie(name: string, value: string) {
  const cookieStore = await cookies();

  cookieStore.set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

function setWorkspaceCookie(
  cookieStore: CookieStore,
  name: string,
  value: string,
) {
  cookieStore.set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function setNormalizedWorkspaceContext(
  workspace: CurrentWorkspaceOption,
) {
  const cookieStore = await cookies();

  setWorkspaceCookie(cookieStore, SELECTED_WORKSPACE_COOKIE, workspace.id);

  if (workspace.accountId) {
    setWorkspaceCookie(cookieStore, CURRENT_ACCOUNT_COOKIE, workspace.accountId);
  } else {
    cookieStore.delete(CURRENT_ACCOUNT_COOKIE);
  }

  if (workspace.type === "personal" || workspace.type === "account") {
    cookieStore.delete(CURRENT_MANAGE_SALON_COOKIE);
    cookieStore.delete(CURRENT_STAFF_SALON_COOKIE);
    cookieStore.delete(LEGACY_CURRENT_SALON_COOKIE);
    return;
  }

  if (workspace.salonMode === "manage") {
    if (!workspace.salonId) {
      throw new Error("That managed salon workspace is incomplete.");
    }

    setWorkspaceCookie(
      cookieStore,
      CURRENT_MANAGE_SALON_COOKIE,
      workspace.salonId,
    );
    setWorkspaceCookie(
      cookieStore,
      LEGACY_CURRENT_SALON_COOKIE,
      workspace.salonId,
    );
    cookieStore.delete(CURRENT_STAFF_SALON_COOKIE);
    return;
  }

  if (workspace.salonMode === "staff") {
    if (!workspace.salonId) {
      throw new Error("That staff workspace is missing a salon.");
    }

    setWorkspaceCookie(
      cookieStore,
      CURRENT_STAFF_SALON_COOKIE,
      workspace.salonId,
    );
    cookieStore.delete(CURRENT_MANAGE_SALON_COOKIE);
    cookieStore.delete(LEGACY_CURRENT_SALON_COOKIE);
  }
}

export function getWorkspaceActionHrefs(workspace: CurrentWorkspaceOption) {
  return new Set(
    [
      workspace.defaultHref,
      workspace.primaryAction?.href,
      workspace.secondaryAction?.href,
      ...workspace.quickActions.map((action) => action.href),
      ...workspace.menuActions.map((action) => action.href),
    ].filter((href): href is string => Boolean(href)),
  );
}

export function isWorkspaceDestinationAllowed(
  workspace: CurrentWorkspaceOption,
  destinationHref: string,
) {
  if (!destinationHref.startsWith("/") || destinationHref.startsWith("//")) {
    return false;
  }

  return getWorkspaceActionHrefs(workspace).has(destinationHref);
}

export async function setCurrentAccountCookie(accountId: string) {
  await setPersistentCookie(CURRENT_ACCOUNT_COOKIE, accountId);
  await setSelectedWorkspaceCookie(getAccountWorkspaceId(accountId));
}

export async function setCurrentManageSalonCookie(salonId: string) {
  await setPersistentCookie(CURRENT_MANAGE_SALON_COOKIE, salonId);
  await setPersistentCookie(LEGACY_CURRENT_SALON_COOKIE, salonId);
  await setSelectedWorkspaceCookie(getManageWorkspaceId(salonId));
}

export async function setCurrentStaffSalonCookie(salonId: string) {
  await setPersistentCookie(CURRENT_STAFF_SALON_COOKIE, salonId);
  await setSelectedWorkspaceCookie(getStaffWorkspaceId(salonId));
}

export async function setCurrentSalonCookie(salonId: string) {
  await setCurrentManageSalonCookie(salonId);
}

export async function setSelectedWorkspaceCookie(workspaceId: string) {
  await setPersistentCookie(SELECTED_WORKSPACE_COOKIE, workspaceId);
}

export function isPersonalContext(context: CurrentBusinessContext) {
  return context.workspaceType === "personal";
}

export function isAccountContext(context: CurrentBusinessContext) {
  return context.workspaceType === "account";
}

export function isSalonManageContext(context: CurrentBusinessContext) {
  return context.workspaceType === "salon" && context.salonMode === "manage";
}

export function isSalonStaffContext(context: CurrentBusinessContext) {
  return context.workspaceType === "salon" && context.salonMode === "staff";
}

export function getRouteForInvalidSalonContext(context: CurrentBusinessContext) {
  if (!context.user) {
    return "/login";
  }

  if (context.workspaceOptions.length <= 1) {
    return "/explore";
  }

  return "/my-place?error=Choose a valid salon workspace before opening that page.";
}
