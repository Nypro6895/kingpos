import { NavigationShell } from "@/app/navigation-shell";
import { GuestNavigationShell } from "@/app/guest-navigation-shell";
import {
  ROLE_NAVIGATION,
  type NavigationLink,
  type NavigationSection,
} from "@/app/role-navigation";
import {
  isAccountContext,
  isOwnerMembership,
  isSalonManageContext,
  isSalonStaffContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { routes } from "@/lib/routes";
import { getWorkspacePendingSummary } from "@/lib/workspace-pending";

const MANAGEMENT_PERMISSION_CODES = {
  bookings: "booking.view",
  customers: "customers.view",
  payroll: "payroll.view",
  payrollManage: "payroll.manage",
  posManage: "tickets.manage",
  posTickets: "tickets.view",
  reports: "reports.view",
  salonSettings: "salon_settings.view",
  salonProfile: "salon_profile.view",
  services: "services.view",
  staff: "staff.view",
  staffManage: "staff.manage",
} as const;

async function can(
  context: CurrentBusinessContext,
  code: string,
  isOwner: boolean,
) {
  if (isOwner && isSalonManageContext(context)) {
    return true;
  }

  return hasPermission(code, context);
}

function salonOption(salon: { id: string; name: string }) {
  return {
    id: salon.id,
    name: salon.name,
  };
}

function buildStaffNavigation(): NavigationSection[] {
  return [
    {
      id: "staff-navigation",
      label: "Navigation",
      links: ROLE_NAVIGATION.staff.links,
    },
  ];
}

function buildManageNavigation(input: {
  canManagePayroll: boolean;
  canManagePos: boolean;
  canViewBookings: boolean;
  canViewCustomers: boolean;
  canViewPayroll: boolean;
  canViewReports: boolean;
  canViewSalonProfile: boolean;
  canViewSalonSettings: boolean;
  canViewServices: boolean;
  canViewStaff: boolean;
  canViewTickets: boolean;
}): NavigationSection[] {
  const links = ROLE_NAVIGATION.owner.links.filter((link) => {
    if (link.id === "owner-today") {
      return input.canViewStaff;
    }

    if (link.id === "owner-book") {
      return input.canViewBookings;
    }

    if (link.id === "owner-profile") {
      return input.canViewSalonProfile;
    }

    return true;
  });

  return [
    {
      id: "owner-navigation",
      label: "Navigation",
      links,
    },
  ].filter((section) => section.links.length > 0);
}

function buildAccountNavigation(context: CurrentBusinessContext) {
  const isOwner = isOwnerMembership(context.currentMembership);
  const links: NavigationLink[] = [
    {
      href: routes.salons.list(),
      icon: "store",
      id: "salons",
      label: "Salons",
    },
  ];

  if (isOwner) {
    links.push(
      { href: "/roles", icon: "people", id: "roles", label: "Members & Roles" },
      {
        href: "/permissions",
        icon: "gear",
        id: "permissions",
        label: "Account Permissions",
      },
    );
  }

  return [
    {
      id: "account",
      label: "Account",
      links,
    },
  ];
}

export async function SalonSwitcher({
  children,
  context,
}: {
  children: React.ReactNode;
  context: CurrentBusinessContext;
}) {
  if (!context.user) {
    return <GuestNavigationShell>{children}</GuestNavigationShell>;
  }

  const isOwner = isOwnerMembership(context.currentMembership);
  const isManageContext = isSalonManageContext(context);
  const [
    canViewBookings,
    canViewCustomers,
    canViewPayroll,
    canManagePayroll,
    canManagePos,
    canViewTickets,
    canViewReports,
    canViewSalonProfile,
    canViewSalonSettings,
    canViewServices,
    canViewStaff,
    canManageStaff,
  ] = isManageContext
    ? await Promise.all([
        can(context, MANAGEMENT_PERMISSION_CODES.bookings, isOwner),
        can(context, MANAGEMENT_PERMISSION_CODES.customers, isOwner),
        can(context, MANAGEMENT_PERMISSION_CODES.payroll, isOwner),
        can(context, MANAGEMENT_PERMISSION_CODES.payrollManage, isOwner),
        can(context, MANAGEMENT_PERMISSION_CODES.posManage, isOwner),
        can(context, MANAGEMENT_PERMISSION_CODES.posTickets, isOwner),
        can(context, MANAGEMENT_PERMISSION_CODES.reports, isOwner),
        can(context, MANAGEMENT_PERMISSION_CODES.salonProfile, isOwner),
        can(context, MANAGEMENT_PERMISSION_CODES.salonSettings, isOwner),
        can(context, MANAGEMENT_PERMISSION_CODES.services, isOwner),
        can(context, MANAGEMENT_PERMISSION_CODES.staff, isOwner),
        can(context, MANAGEMENT_PERMISSION_CODES.staffManage, isOwner),
      ])
    : [
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ];
  const notifications = await getWorkspacePendingSummary(context);
  const workspaceSections = isSalonStaffContext(context)
    ? buildStaffNavigation()
    : isManageContext
      ? await buildManageNavigation({
          canManagePayroll,
          canManagePos,
          canViewBookings,
          canViewCustomers,
          canViewPayroll,
          canViewReports,
          canViewSalonProfile,
          canViewSalonSettings,
          canViewServices,
          canViewStaff,
          canViewTickets,
        })
      : isAccountContext(context)
        ? buildAccountNavigation(context)
        : [];
  const canSwitchManageSalon =
    context.availableManageSalons.length > 1 &&
    (isOwner ||
      canViewStaff ||
      canManageStaff ||
      canViewPayroll ||
      canManagePayroll ||
      canViewReports ||
      canViewSalonProfile ||
      canViewSalonSettings ||
      canViewServices ||
      canViewBookings ||
      canViewCustomers ||
      canManagePos ||
      canViewTickets);

  return (
    <NavigationShell
      accountAvatarUrl={context.user.avatar_url}
      accountEmail={context.user.email}
      accountLabel={context.user.display_name ?? context.user.email ?? "Account"}
      canManageStaff={canManageStaff}
      canSwitchManageSalon={canSwitchManageSalon}
      currentManageSalonId={
        context.salonMode === "manage" ? (context.currentSalon?.id ?? null) : null
      }
      currentManageSalonName={
        context.salonMode === "manage" ? (context.currentSalon?.name ?? null) : null
      }
      currentAccountName={context.accountName}
      currentStaffSalonId={
        context.salonMode === "staff" ? (context.currentSalon?.id ?? null) : null
      }
      currentStaffSalonName={
        context.salonMode === "staff" ? (context.currentSalon?.name ?? null) : null
      }
      currentWorkspace={context.currentWorkspace}
      manageSalons={context.availableManageSalons.map(salonOption)}
      notificationSummary={notifications}
      staffSalons={context.availableStaffSalons.map(salonOption)}
      workspaceOptions={context.workspaceOptions}
      workspaceSections={workspaceSections}
      workspaceType={context.workspaceType}
      salonMode={context.salonMode}
    >
      {children}
    </NavigationShell>
  );
}
