import "server-only";

import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type { Location } from "@/types/location";
import type { Organization } from "@/types/organization";
import type { OrganizationMembershipWithOrganization } from "@/types/membership";
import type { Role } from "@/types/role";
import type { KingUser } from "@/types/user";
import { cookies } from "next/headers";

export const LEGACY_CURRENT_SALON_COOKIE = "kingpos-current-salon-id";
export const CURRENT_ORGANIZATION_COOKIE = "kingpos-current-organization-id";
export const CURRENT_MANAGE_SALON_COOKIE = "kingpos-current-manage-salon-id";
export const CURRENT_STAFF_SALON_COOKIE = "kingpos-current-staff-salon-id";
export const SELECTED_WORKSPACE_COOKIE = "kingpos-selected-workspace";

export const CURRENT_SALON_COOKIE = CURRENT_MANAGE_SALON_COOKIE;

export const ORGANIZATION_SELECT =
  "id, name, legal_name, owner_user_id, status, created_at, updated_at";

export const LOCATION_SELECT =
  "id, organization_id, name, phone, address_line1, address_line2, city, state, postal_code, country, latitude, longitude, status, created_at, updated_at";

export const ROLE_SELECT =
  "id, organization_id, name, code, description, is_system, created_at, updated_at";

const ROLE_PERMISSION_SELECT = "id, role_id, permission_id, created_at";
const PERMISSION_SELECT = "id, code";

export type WorkspaceType = "organization" | "personal" | "salon";
export type SalonMode = "manage" | "staff";

export type CurrentWorkspaceAction = {
  href: string;
  id: string;
  label: string;
};

export type CurrentWorkspaceOption = {
  defaultHref: string;
  description: string | null;
  id: string;
  label: string;
  menuActions: CurrentWorkspaceAction[];
  organizationId: string | null;
  organizationName: string | null;
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

export type CurrentBusinessContext = {
  accountRole: string | null;
  activeRole: CurrentActiveRole | null;
  availableManageSalons: Location[];
  availableOrganizations: Organization[];
  availableStaffSalons: Location[];
  availableWorkspaceModes: SalonMode[];
  currentMembership: OrganizationMembershipWithOrganization | null;
  currentOrganization: Organization | null;
  currentSalon: Location | null;
  currentStaffSalon: Location | null;
  currentWorkspace: CurrentWorkspaceOption | null;
  defaultRouteForCurrentContext: string;
  manageMemberships: OrganizationMembershipWithOrganization[];
  organizationId: string | null;
  organizationName: string | null;
  permissionCodes: string[];
  permissions: string[];
  salonId: string | null;
  salonMode: SalonMode | null;
  salonName: string | null;
  salonRole: string | null;
  salons: Location[];
  staffSalons: Location[];
  user: KingUser | null;
  workspaceOptions: CurrentWorkspaceOption[];
  workspaceType: WorkspaceType;
};

type OrganizationMembershipRow = Omit<
  OrganizationMembershipWithOrganization,
  "role"
>;

type StaffContextSalonRow = {
  organization_created_at: string;
  organization_id: string;
  organization_legal_name: string | null;
  organization_name: string;
  organization_owner_user_id: string;
  organization_status: "active" | "archived" | "inactive" | "suspended";
  organization_updated_at: string;
  salon_address_line1: string | null;
  salon_address_line2: string | null;
  salon_city: string | null;
  salon_country: string;
  salon_created_at: string;
  salon_id: string;
  salon_name: string;
  salon_phone: string | null;
  salon_postal_code: string | null;
  salon_state: string | null;
  salon_status: "active" | "inactive";
  salon_updated_at: string;
  staff_id: string;
};

type StaffLinkedBusinessContext = {
  organizationsBySalonId: Map<string, Organization>;
  staffSalons: Location[];
  workspaceOptions: CurrentWorkspaceOption[];
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

export function getPersonalWorkspaceId() {
  return "personal";
}

export function getOrganizationWorkspaceId(organizationId: string) {
  return `organization:${organizationId}`;
}

export function getManageWorkspaceId(salonId: string) {
  return `manage:${salonId}`;
}

export function getStaffWorkspaceId(salonId: string) {
  return `staff:${salonId}`;
}

export function isOwnerMembership(
  membership: OrganizationMembershipWithOrganization | null,
) {
  return membership?.role?.code === "OWNER" || membership?.legacy_role === "owner";
}

export function isMissingRoleIdColumnError(error: { code?: string; message?: string }) {
  return (
    error.code === "42703" ||
    error.message?.includes("organization_memberships.role_id") === true
  );
}

export function roleFromLegacyRole(
  legacyRole: string | null | undefined,
  organizationId: string,
): Role | null {
  if (!legacyRole) {
    return null;
  }

  const roleNames: Record<string, string> = {
    owner: "Owner",
    admin: "Manager",
    manager: "Manager",
    technician: "Technician",
    receptionist: "Front Desk",
    member: "Front Desk",
  };
  const roleCodes: Record<string, string> = {
    owner: "OWNER",
    admin: "MANAGER",
    manager: "MANAGER",
    technician: "TECHNICIAN",
    receptionist: "FRONT_DESK",
    member: "FRONT_DESK",
  };

  return {
    id: "",
    organization_id: organizationId,
    name: roleNames[legacyRole] ?? legacyRole,
    code: roleCodes[legacyRole] ?? legacyRole.toUpperCase(),
    description: null,
    is_system: true,
    created_at: "",
    updated_at: "",
  };
}

function emptyContext(user: KingUser | null): CurrentBusinessContext {
  return {
    accountRole: null,
    activeRole: null,
    availableManageSalons: [],
    availableOrganizations: [],
    availableStaffSalons: [],
    availableWorkspaceModes: [],
    currentMembership: null,
    currentOrganization: null,
    currentSalon: null,
    currentStaffSalon: null,
    currentWorkspace: null,
    defaultRouteForCurrentContext: "/explore",
    manageMemberships: [],
    organizationId: null,
    organizationName: null,
    permissionCodes: [],
    permissions: [],
    salonId: null,
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

function roleLabelForMembership(
  membership: OrganizationMembershipWithOrganization,
) {
  if (isOwnerMembership(membership)) {
    return "Owner";
  }

  return membership.role?.name ?? "Manager";
}

function roleCodeForMembership(
  membership: OrganizationMembershipWithOrganization | null,
) {
  return membership?.role?.code ?? membership?.legacy_role ?? null;
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

  if (
    canUseManageAction(input.permissionCodes, input.isOwner, "tickets.manage")
  ) {
    actions.push(workspaceAction("pos", "POS", "/pos"));
  }

  if (canUseManageAction(input.permissionCodes, input.isOwner, "staff.view")) {
    actions.push(workspaceAction("today", "Today", "/staff/today"));
  }

  if (canUseManageAction(input.permissionCodes, input.isOwner, "booking.view")) {
    actions.push(workspaceAction("bookings", "Bookings", "/bookings"));
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
      "salon_profile.view",
    )
  ) {
    actions.push(
      workspaceAction("salon-profile", "Salon Profile", "/salon-profile"),
    );
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
  const primaryAction =
    actions.find((action) => action.id === "pos") ??
    (defaultAction
      ? workspaceAction("open", "Open", defaultAction.href)
      : null);
  const secondaryAction = defaultAction
    ? workspaceAction("open", "Open", defaultAction.href)
    : null;
  const menuActions = actions.filter((action) => action.id !== primaryAction?.id);

  return {
    menuActions,
    primaryAction,
    quickActions: actions,
    secondaryAction,
  };
}

function buildStaffWorkspaceActions() {
  const myDay = workspaceAction("my-day", "My Day", "/staff/my-work");
  const appointments = workspaceAction(
    "appointments",
    "Appointments",
    "/staff/appointments",
  );
  const salonProfile = workspaceAction(
    "salon-profile",
    "Salon Profile",
    "/salon-profile",
  );
  const myIncome = workspaceAction(
    "my-income",
    "Income",
    "/staff/my-work?tab=payroll",
  );
  const paystubs = workspaceAction(
    "paystubs",
    "Paystubs",
    "/staff/my-work?tab=payroll",
  );
  const analysis = workspaceAction(
    "analysis",
    "My Analysis",
    "/staff/my-work?tab=analysis",
  );

  return {
    menuActions: [appointments, salonProfile, paystubs, analysis],
    primaryAction: myDay,
    quickActions: [myDay, appointments, myIncome],
    secondaryAction: workspaceAction("open", "Open", "/staff/my-work"),
  };
}

function buildOrganizationWorkspaceActions(input: { isOwner: boolean }) {
  const overview = workspaceAction("overview", "Overview", "/organizations");
  const actions = [overview];

  if (input.isOwner) {
    actions.push(
      workspaceAction("salons", "Salons", "/salons"),
      workspaceAction("members", "Members", "/roles"),
      workspaceAction("settings", "Organization Settings", "/permissions"),
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

function groupSalonsByOrganization(salons: Location[]) {
  const salonsByOrganization = new Map<string, Location[]>();

  for (const salon of salons) {
    const organizationSalons = salonsByOrganization.get(salon.organization_id) ?? [];
    organizationSalons.push(salon);
    salonsByOrganization.set(salon.organization_id, organizationSalons);
  }

  return salonsByOrganization;
}

function organizationById(
  memberships: OrganizationMembershipWithOrganization[],
) {
  return new Map(
    memberships
      .map((membership) => membership.organization)
      .filter((organization): organization is Organization => Boolean(organization))
      .map((organization) => [organization.id, organization]),
  );
}

function membershipByOrganizationId(
  memberships: OrganizationMembershipWithOrganization[],
) {
  return new Map(
    memberships.map((membership) => [membership.organization_id, membership]),
  );
}

function buildPersonalWorkspaceOption(): CurrentWorkspaceOption {
  const explore = workspaceAction("explore", "Explore", "/explore");
  const notifications = workspaceAction(
    "notifications",
    "Notifications",
    "/notifications",
  );
  const settings = workspaceAction("settings", "Account Settings", "/settings");

  return {
    defaultHref: "/explore",
    description: "Explore, My Place, Notifications",
    id: getPersonalWorkspaceId(),
    label: "KingPOS",
    menuActions: [settings],
    organizationId: null,
    organizationName: null,
    primaryAction: explore,
    quickActions: [explore, notifications, settings],
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

function buildOrganizationWorkspaceOption(input: {
  membership: OrganizationMembershipWithOrganization;
  salonCount: number | null;
}): CurrentWorkspaceOption | null {
  const membership = input.membership;
  const organization = membership.organization;

  if (!organization) {
    return null;
  }

  const actionSet = buildOrganizationWorkspaceActions({
    isOwner: isOwnerMembership(membership),
  });

  return {
    defaultHref: "/organizations",
    description: organization.legal_name,
    id: getOrganizationWorkspaceId(organization.id),
    label: organization.name,
    menuActions: actionSet.menuActions,
    organizationId: organization.id,
    organizationName: organization.name,
    primaryAction: actionSet.primaryAction,
    quickActions: actionSet.quickActions,
    roleCode: roleCodeForMembership(membership),
    roleLabel: roleLabelForMembership(membership),
    salonCount: input.salonCount,
    salonId: null,
    salonMode: null,
    salonName: null,
    secondaryAction: actionSet.secondaryAction,
    type: "organization",
  };
}

function getManageDefaultRoute(permissionCodes: Set<string>, isOwner: boolean) {
  if (isOwner || permissionCodes.has("tickets.manage")) {
    return "/pos";
  }

  if (permissionCodes.has("staff.view")) {
    return "/staff";
  }

  if (permissionCodes.has("booking.view")) {
    return "/bookings";
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
  membership: OrganizationMembershipWithOrganization;
  permissionCodes: Set<string>;
  salon: Location;
}): CurrentWorkspaceOption | null {
  const organization = input.membership.organization;

  if (!organization) {
    return null;
  }

  const isOwner = isOwnerMembership(input.membership);
  const defaultHref = getManageDefaultRoute(input.permissionCodes, isOwner);
  const actionSet = buildManageWorkspaceActions({
    defaultHref,
    isOwner,
    permissionCodes: input.permissionCodes,
  });

  return {
    defaultHref,
    description: organization.name,
    id: getManageWorkspaceId(input.salon.id),
    label: input.salon.name,
    menuActions: actionSet.menuActions,
    organizationId: organization.id,
    organizationName: organization.name,
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

async function loadCurrentMemberships() {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const user = await getCurrentKingUser();

  if (!supabase || !user) {
    return { memberships: [] as OrganizationMembershipWithOrganization[], user };
  }

  const membershipQuery = supabase
    .from("organization_memberships")
    .select(
      `id, organization_id, user_id, role_id, status, invited_by_user_id, joined_at, created_at, updated_at, organization:organizations(${ORGANIZATION_SELECT})`,
    )
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  const { data: memberships, error: membershipError } =
    await membershipQuery.returns<OrganizationMembershipRow[]>();

  if (!membershipError) {
    const hydratedMemberships = await hydrateMembershipRoles(memberships ?? []);
    return { memberships: hydratedMemberships, user };
  }

  if (!isMissingRoleIdColumnError(membershipError)) {
    console.error("Supabase load current organization memberships failed", {
      code: membershipError.code,
      message: membershipError.message,
      details: membershipError.details,
      hint: membershipError.hint,
      userId: user.id,
    });
    throw new Error(membershipError.message);
  }

  const { data: legacyMemberships, error: legacyMembershipError } = await supabase
    .from("organization_memberships")
    .select(
      `id, organization_id, user_id, legacy_role:role, status, invited_by_user_id, joined_at, created_at, updated_at, organization:organizations(${ORGANIZATION_SELECT})`,
    )
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .returns<OrganizationMembershipRow[]>();

  if (legacyMembershipError) {
    console.error("Supabase load legacy organization memberships failed", {
      code: legacyMembershipError.code,
      message: legacyMembershipError.message,
      details: legacyMembershipError.details,
      hint: legacyMembershipError.hint,
      userId: user.id,
    });
    throw new Error(legacyMembershipError.message);
  }

  const hydratedLegacyMemberships = (legacyMemberships ?? []).map((membership) => ({
    ...membership,
    role: roleFromLegacyRole(membership.legacy_role, membership.organization_id),
  }));

  return { memberships: hydratedLegacyMemberships, user };
}

async function hydrateMembershipRoles(memberships: OrganizationMembershipRow[]) {
  const roleIds = Array.from(
    new Set(
      memberships
        .map((membership) => membership.role_id)
        .filter((roleId): roleId is string => Boolean(roleId)),
    ),
  );

  if (roleIds.length === 0) {
    return memberships.map((membership) => ({
      ...membership,
      role: roleFromLegacyRole(membership.legacy_role, membership.organization_id),
    }));
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data: roles, error: rolesError } = await supabase
    .from("roles")
    .select(ROLE_SELECT)
    .in("id", roleIds)
    .returns<Role[]>();

  if (rolesError) {
    console.error("Supabase load membership roles failed", {
      code: rolesError.code,
      message: rolesError.message,
      details: rolesError.details,
      hint: rolesError.hint,
      roleIds,
    });
    throw new Error(rolesError.message);
  }

  const roleById = new Map((roles ?? []).map((role) => [role.id, role]));

  return memberships.map((membership) => ({
    ...membership,
    role: membership.role_id
      ? (roleById.get(membership.role_id) ?? null)
      : roleFromLegacyRole(membership.legacy_role, membership.organization_id),
  }));
}

async function loadPermissionCodesForMembership(
  membership: OrganizationMembershipWithOrganization | null,
) {
  if (!membership || !membership.role_id) {
    return new Set<string>();
  }

  if (isOwnerMembership(membership)) {
    return new Set(["*"]);
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data: rolePermissions, error: rolePermissionsError } = await supabase
    .from("role_permissions")
    .select(ROLE_PERMISSION_SELECT)
    .eq("role_id", membership.role_id)
    .returns<RolePermissionRow[]>();

  if (rolePermissionsError) {
    console.error("Supabase load role permissions for context failed", {
      code: rolePermissionsError.code,
      message: rolePermissionsError.message,
      details: rolePermissionsError.details,
      hint: rolePermissionsError.hint,
      roleId: membership.role_id,
      organizationId: membership.organization_id,
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
    console.error("Supabase load permission codes for context failed", {
      code: permissionsError.code,
      message: permissionsError.message,
      details: permissionsError.details,
      hint: permissionsError.hint,
      roleId: membership.role_id,
      organizationId: membership.organization_id,
    });
    throw new Error(permissionsError.message);
  }

  return new Set((permissions ?? []).map((permission) => permission.code));
}

async function loadStaffLinkedBusinessContext(
  user: KingUser,
): Promise<StaffLinkedBusinessContext | null> {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.rpc(
    "list_current_staff_context_salons",
  );

  if (error) {
    console.error("Supabase load staff-linked context failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      userId: user.id,
    });
    return null;
  }

  const rows = Array.isArray(data) ? (data as StaffContextSalonRow[]) : [];

  if (rows.length === 0) {
    return null;
  }

  const organizationsBySalonId = new Map<string, Organization>();
  const staffSalonsById = new Map<string, Location>();
  const staffWorkspaceOptionsById = new Map<string, CurrentWorkspaceOption>();
  const staffActionSet = buildStaffWorkspaceActions();

  for (const row of rows) {
    const organization = {
      created_at: row.organization_created_at,
      id: row.organization_id,
      legal_name: row.organization_legal_name,
      name: row.organization_name,
      owner_user_id: row.organization_owner_user_id,
      status: row.organization_status,
      updated_at: row.organization_updated_at,
    };

    if (!organizationsBySalonId.has(row.salon_id)) {
      organizationsBySalonId.set(row.salon_id, organization);
    }

    if (!staffSalonsById.has(row.salon_id)) {
      staffSalonsById.set(row.salon_id, {
        address_line1: row.salon_address_line1,
        address_line2: row.salon_address_line2,
        city: row.salon_city,
        country: row.salon_country,
        created_at: row.salon_created_at,
        id: row.salon_id,
        latitude: null,
        longitude: null,
        name: row.salon_name,
        organization_id: row.organization_id,
        phone: row.salon_phone,
        postal_code: row.salon_postal_code,
        state: row.salon_state,
        status: row.salon_status,
        updated_at: row.salon_updated_at,
      });
    }

    if (!staffWorkspaceOptionsById.has(row.salon_id)) {
      staffWorkspaceOptionsById.set(row.salon_id, {
        defaultHref: "/staff/my-work",
        description: row.organization_name,
        id: getStaffWorkspaceId(row.salon_id),
        label: row.salon_name,
        menuActions: staffActionSet.menuActions,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        primaryAction: staffActionSet.primaryAction,
        quickActions: staffActionSet.quickActions,
        roleCode: "STAFF",
        roleLabel: "Staff",
        salonCount: null,
        salonId: row.salon_id,
        salonMode: "staff",
        salonName: row.salon_name,
        secondaryAction: staffActionSet.secondaryAction,
        type: "salon",
      });
    }
  }

  return {
    organizationsBySalonId,
    staffSalons: [...staffSalonsById.values()],
    workspaceOptions: [...staffWorkspaceOptionsById.values()],
  };
}

function resolveWorkspaceFromCookie(input: {
  cookieStore: CookieStore;
  fallbackWorkspace: CurrentWorkspaceOption;
  organizationOptions: CurrentWorkspaceOption[];
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const storedWorkspaceId =
    input.cookieStore.get(SELECTED_WORKSPACE_COOKIE)?.value ?? null;

  if (!storedWorkspaceId) {
    return input.fallbackWorkspace;
  }

  const exactWorkspace = input.workspaceOptions.find(
    (workspace) => workspace.id === storedWorkspaceId,
  );

  if (exactWorkspace) {
    return exactWorkspace;
  }

  if (storedWorkspaceId.startsWith("manage:")) {
    const legacyId = storedWorkspaceId.slice("manage:".length);
    const organizationWorkspace = input.organizationOptions.find(
      (workspace) => workspace.organizationId === legacyId,
    );

    if (organizationWorkspace) {
      return organizationWorkspace;
    }
  }

  return input.fallbackWorkspace;
}

function getFallbackWorkspace(input: {
  cookieStore: CookieStore;
  personalWorkspace: CurrentWorkspaceOption;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const manageSalonId =
    input.cookieStore.get(CURRENT_MANAGE_SALON_COOKIE)?.value ??
    input.cookieStore.get(LEGACY_CURRENT_SALON_COOKIE)?.value ??
    null;
  const staffSalonId =
    input.cookieStore.get(CURRENT_STAFF_SALON_COOKIE)?.value ?? null;

  if (manageSalonId) {
    const manageWorkspace = input.workspaceOptions.find(
      (workspace) =>
        workspace.salonMode === "manage" && workspace.salonId === manageSalonId,
    );

    if (manageWorkspace) {
      return manageWorkspace;
    }
  }

  if (staffSalonId) {
    const staffWorkspace = input.workspaceOptions.find(
      (workspace) =>
        workspace.salonMode === "staff" && workspace.salonId === staffSalonId,
    );

    if (staffWorkspace) {
      return staffWorkspace;
    }
  }

  return input.personalWorkspace;
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

function permissionArray(permissionCodes: Set<string>) {
  return [...permissionCodes].sort((left, right) => left.localeCompare(right));
}

export async function getCurrentStaffBusinessContext(): Promise<CurrentBusinessContext> {
  const user = await getCurrentKingUser();

  if (!user) {
    return emptyContext(user);
  }

  const staffLinkedContext = await loadStaffLinkedBusinessContext(user);

  if (!staffLinkedContext || staffLinkedContext.staffSalons.length === 0) {
    return emptyContext(user);
  }

  const cookieStore = await cookies();
  const storedStaffSalonId =
    cookieStore.get(CURRENT_STAFF_SALON_COOKIE)?.value ??
    cookieStore.get(LEGACY_CURRENT_SALON_COOKIE)?.value ??
    null;
  const currentStaffSalon =
    (storedStaffSalonId
      ? staffLinkedContext.staffSalons.find((salon) => salon.id === storedStaffSalonId)
      : null) ?? staffLinkedContext.staffSalons[0];
  const currentWorkspace =
    staffLinkedContext.workspaceOptions.find(
      (workspace) => workspace.salonId === currentStaffSalon.id,
    ) ?? staffLinkedContext.workspaceOptions[0];
  const currentOrganization =
    staffLinkedContext.organizationsBySalonId.get(currentStaffSalon.id) ?? null;

  return {
    accountRole: null,
    activeRole: buildActiveRole(currentWorkspace, null),
    availableManageSalons: [],
    availableOrganizations: currentOrganization ? [currentOrganization] : [],
    availableStaffSalons: staffLinkedContext.staffSalons,
    availableWorkspaceModes: ["staff"],
    currentMembership: null,
    currentOrganization,
    currentSalon: currentStaffSalon,
    currentStaffSalon,
    currentWorkspace,
    defaultRouteForCurrentContext: currentWorkspace?.defaultHref ?? "/staff/my-work",
    manageMemberships: [],
    organizationId: currentOrganization?.id ?? null,
    organizationName: currentOrganization?.name ?? null,
    permissionCodes: [],
    permissions: [],
    salonId: currentStaffSalon.id,
    salonMode: "staff",
    salonName: currentStaffSalon.name,
    salonRole: "Staff",
    salons: staffLinkedContext.staffSalons,
    staffSalons: staffLinkedContext.staffSalons,
    user,
    workspaceOptions: staffLinkedContext.workspaceOptions,
    workspaceType: "salon",
  };
}

export async function getCurrentBusinessContext(): Promise<CurrentBusinessContext> {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const { memberships, user } = await loadCurrentMemberships();

  if (!supabase || !user) {
    return emptyContext(user);
  }

  const cookieStore = await cookies();
  const organizationIds = memberships
    .map((membership) => membership.organization?.id)
    .filter((organizationId): organizationId is string => Boolean(organizationId));
  const { data: allSalons, error: allSalonsError } =
    organizationIds.length > 0
      ? await supabase
          .from("locations")
          .select(LOCATION_SELECT)
          .in("organization_id", organizationIds)
          .order("created_at", { ascending: true })
          .returns<Location[]>()
      : { data: [] as Location[], error: null };

  if (allSalonsError) {
    console.error("Supabase load managed organization salons failed", {
      code: allSalonsError.code,
      message: allSalonsError.message,
      details: allSalonsError.details,
      hint: allSalonsError.hint,
      organizationIds,
      userId: user.id,
    });
    throw new Error(allSalonsError.message);
  }

  const personalWorkspace = buildPersonalWorkspaceOption();
  const organizations = [...organizationById(memberships).values()];
  const membershipsByOrganizationId = membershipByOrganizationId(memberships);
  const salonsByOrganization = groupSalonsByOrganization(allSalons ?? []);
  const membershipPermissionCodes = new Map<string, Set<string>>();

  for (const membership of memberships) {
    membershipPermissionCodes.set(
      membership.organization_id,
      await loadPermissionCodesForMembership(membership),
    );
  }

  const organizationOptions = memberships
    .map((membership) =>
      buildOrganizationWorkspaceOption({
        membership,
        salonCount: membership.organization
          ? (salonsByOrganization.get(membership.organization.id)?.length ?? 0)
          : null,
      }),
    )
    .filter(
      (workspace): workspace is CurrentWorkspaceOption => workspace !== null,
    );
  const manageWorkspaceOptions = memberships.flatMap((membership) => {
    const organization = membership.organization;
    const organizationSalons = organization
      ? (salonsByOrganization.get(organization.id) ?? [])
      : [];
    const permissionCodes =
      membershipPermissionCodes.get(membership.organization_id) ?? new Set<string>();

    return organizationSalons
      .map((salon) =>
        buildManageWorkspaceOption({
          membership,
          permissionCodes,
          salon,
        }),
      )
      .filter(
        (workspace): workspace is CurrentWorkspaceOption => workspace !== null,
      );
  });
  const staffLinkedContext = await loadStaffLinkedBusinessContext(user);
  const workspaceOptions = [
    personalWorkspace,
    ...organizationOptions,
    ...manageWorkspaceOptions,
    ...(staffLinkedContext?.workspaceOptions ?? []),
  ];
  const fallbackWorkspace = getFallbackWorkspace({
    cookieStore,
    personalWorkspace,
    workspaceOptions,
  });
  const currentWorkspace = resolveWorkspaceFromCookie({
    cookieStore,
    fallbackWorkspace,
    organizationOptions,
    workspaceOptions,
  });
  const activeOrganizationId = currentWorkspace.organizationId;
  const activeSalonId = currentWorkspace.salonId;
  const currentMembership =
    currentWorkspace.type === "organization" ||
    currentWorkspace.salonMode === "manage"
      ? activeOrganizationId
        ? (membershipsByOrganizationId.get(activeOrganizationId) ?? null)
        : null
      : null;
  const currentOrganization =
    currentWorkspace.type === "personal"
      ? null
      : currentWorkspace.salonMode === "staff" && activeSalonId
        ? (staffLinkedContext?.organizationsBySalonId.get(activeSalonId) ?? null)
        : activeOrganizationId
          ? (organizations.find((organization) => organization.id === activeOrganizationId) ??
            null)
          : null;
  const currentSalon =
    currentWorkspace.salonMode === "manage" && activeSalonId
      ? ((allSalons ?? []).find((salon) => salon.id === activeSalonId) ?? null)
      : currentWorkspace.salonMode === "staff" && activeSalonId
        ? (staffLinkedContext?.staffSalons.find((salon) => salon.id === activeSalonId) ??
          null)
        : null;
  const activeOrganizationSalons = currentOrganization
    ? (salonsByOrganization.get(currentOrganization.id) ?? [])
    : [];
  const permissionCodes =
    currentMembership && currentWorkspace.salonMode !== "staff"
      ? (membershipPermissionCodes.get(currentMembership.organization_id) ??
        new Set<string>())
      : new Set<string>();
  const accountRole = currentMembership ? roleLabelForMembership(currentMembership) : null;
  const activePermissions = permissionArray(permissionCodes);
  const defaultRouteForCurrentContext =
    currentWorkspace.type === "personal"
      ? "/explore"
      : currentWorkspace.defaultHref;

  return {
    accountRole,
    activeRole: buildActiveRole(currentWorkspace, accountRole),
    availableManageSalons: allSalons ?? [],
    availableOrganizations: organizations,
    availableStaffSalons: staffLinkedContext?.staffSalons ?? [],
    availableWorkspaceModes: getModesForSalon({
      salonId: currentWorkspace.salonId,
      workspaceOptions,
    }),
    currentMembership,
    currentOrganization,
    currentSalon,
    currentStaffSalon: currentWorkspace.salonMode === "staff" ? currentSalon : null,
    currentWorkspace,
    defaultRouteForCurrentContext,
    manageMemberships: memberships,
    organizationId: currentOrganization?.id ?? null,
    organizationName: currentOrganization?.name ?? null,
    permissionCodes: activePermissions,
    permissions: activePermissions,
    salonId: currentSalon?.id ?? null,
    salonMode: currentWorkspace.salonMode,
    salonName: currentSalon?.name ?? null,
    salonRole: currentWorkspace.salonMode
      ? currentWorkspace.roleLabel
      : null,
    salons: activeOrganizationSalons,
    staffSalons: staffLinkedContext?.staffSalons ?? [],
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

  if (workspace.type === "personal") {
    setWorkspaceCookie(cookieStore, SELECTED_WORKSPACE_COOKIE, workspace.id);
    cookieStore.delete(CURRENT_ORGANIZATION_COOKIE);
    cookieStore.delete(CURRENT_MANAGE_SALON_COOKIE);
    cookieStore.delete(CURRENT_STAFF_SALON_COOKIE);
    cookieStore.delete(LEGACY_CURRENT_SALON_COOKIE);
    return;
  }

  if (workspace.type === "organization") {
    if (!workspace.organizationId) {
      throw new Error("That organization workspace is missing an organization.");
    }

    setWorkspaceCookie(
      cookieStore,
      CURRENT_ORGANIZATION_COOKIE,
      workspace.organizationId,
    );
    setWorkspaceCookie(cookieStore, SELECTED_WORKSPACE_COOKIE, workspace.id);
    cookieStore.delete(CURRENT_MANAGE_SALON_COOKIE);
    cookieStore.delete(CURRENT_STAFF_SALON_COOKIE);
    cookieStore.delete(LEGACY_CURRENT_SALON_COOKIE);
    return;
  }

  if (workspace.salonMode === "manage") {
    if (!workspace.organizationId || !workspace.salonId) {
      throw new Error("That managed salon workspace is incomplete.");
    }

    setWorkspaceCookie(
      cookieStore,
      CURRENT_ORGANIZATION_COOKIE,
      workspace.organizationId,
    );
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
    setWorkspaceCookie(cookieStore, SELECTED_WORKSPACE_COOKIE, workspace.id);
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
    setWorkspaceCookie(cookieStore, SELECTED_WORKSPACE_COOKIE, workspace.id);
    cookieStore.delete(CURRENT_ORGANIZATION_COOKIE);
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

export async function setCurrentOrganizationCookie(organizationId: string) {
  await setPersistentCookie(CURRENT_ORGANIZATION_COOKIE, organizationId);
  await setSelectedWorkspaceCookie(getOrganizationWorkspaceId(organizationId));
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

export function isOrganizationContext(context: CurrentBusinessContext) {
  return context.workspaceType === "organization";
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
