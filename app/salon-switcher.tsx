import { NavigationShell } from "@/app/navigation-shell";
import {
  isOrganizationContext,
  isOwnerMembership,
  isSalonManageContext,
  isSalonStaffContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { getWorkspacePendingSummary } from "@/lib/workspace-pending";

type NavigationIcon =
  | "bell"
  | "book"
  | "briefcase"
  | "calendar"
  | "cash"
  | "compass"
  | "gear"
  | "home"
  | "list"
  | "people"
  | "receipt"
  | "scissors"
  | "store"
  | "user";

type NavigationLink = {
  href: string;
  icon: NavigationIcon;
  id: string;
  label: string;
};

type NavigationSection = {
  id: string;
  label: string;
  links: NavigationLink[];
};

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
      id: "staff-workplace",
      label: "Workplace",
      links: [
        { href: "/staff/my-work", icon: "home", id: "staff-day", label: "My Day" },
        {
          href: "/staff/appointments",
          icon: "calendar",
          id: "staff-appointments",
          label: "Appointments",
        },
        {
          href: "/staff/my-work?tab=payroll",
          icon: "cash",
          id: "staff-income",
          label: "My Income",
        },
        {
          href: "/staff/my-work?tab=analysis",
          icon: "list",
          id: "staff-analysis",
          label: "Analysis",
        },
        {
          href: "/staff/connections",
          icon: "people",
          id: "staff-connections",
          label: "Connections",
        },
      ],
    },
    {
      id: "staff-connect",
      label: "Connect",
      links: [
        {
          href: "/salon-profile",
          icon: "compass",
          id: "staff-salon-profile",
          label: "Salon Profile",
        },
      ],
    },
  ];
}

async function buildManageNavigation(input: {
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
}): Promise<NavigationSection[]> {
  const operationsLinks: NavigationLink[] = [];
  const teamLinks: NavigationLink[] = [];
  const financeLinks: NavigationLink[] = [];
  const settingsLinks: NavigationLink[] = [];

  if (input.canManagePos) {
    operationsLinks.push({ href: "/pos", icon: "store", id: "pos", label: "POS" });
  }

  if (input.canViewStaff) {
    operationsLinks.push({
      href: "/staff/today",
      icon: "calendar",
      id: "staff-today",
      label: "Today",
    });
  }

  if (input.canViewBookings) {
    operationsLinks.push({
      href: "/bookings",
      icon: "book",
      id: "bookings",
      label: "Bookings",
    });
  }

  if (input.canViewCustomers) {
    operationsLinks.push({
      href: "/customers",
      icon: "user",
      id: "customers",
      label: "Customers",
    });
  }

  if (input.canViewStaff) {
    teamLinks.push({ href: "/staff", icon: "people", id: "staff", label: "Staff" });
  }

  if (input.canViewServices) {
    teamLinks.push({
      href: "/services",
      icon: "scissors",
      id: "services",
      label: "Services",
    });
  }

  if (input.canViewSalonProfile) {
    teamLinks.push({
      href: "/salon-profile",
      icon: "compass",
      id: "salon-profile",
      label: "Salon Profile",
    });
  }

  if (input.canViewTickets) {
    financeLinks.push({
      href: "/pos-tickets",
      icon: "receipt",
      id: "pos-tickets",
      label: "Tickets",
    });
  }

  if (input.canViewPayroll || input.canManagePayroll) {
    financeLinks.push({
      href: "/payroll",
      icon: "cash",
      id: "payroll",
      label: "Payroll",
    });
  }

  if (input.canViewReports) {
    financeLinks.push({
      href: "/reports",
      icon: "list",
      id: "reports",
      label: "Reports",
    });
  }

  if (input.canViewSalonSettings) {
    settingsLinks.push({
      href: "/salon-settings",
      icon: "gear",
      id: "salon-settings",
      label: "Salon Settings",
    });
  }

  return [
    { id: "manage-operations", label: "Operations", links: operationsLinks },
    { id: "manage-team", label: "Team & Catalog", links: teamLinks },
    { id: "manage-finance", label: "Finance", links: financeLinks },
    { id: "manage-settings", label: "Settings", links: settingsLinks },
  ].filter((section) => section.links.length > 0);
}

function buildOrganizationNavigation(context: CurrentBusinessContext) {
  const isOwner = isOwnerMembership(context.currentMembership);
  const links: NavigationLink[] = [
    {
      href: "/organizations",
      icon: "briefcase",
      id: "organization-overview",
      label: "Organizations",
    },
  ];

  if (isOwner) {
    links.push(
      { href: "/salons", icon: "store", id: "salons", label: "Salons" },
      { href: "/roles", icon: "people", id: "roles", label: "Members & Roles" },
      {
        href: "/permissions",
        icon: "gear",
        id: "permissions",
        label: "Organization Settings",
      },
    );
  }

  return [
    {
      id: "organization",
      label: "Organization",
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
    return <>{children}</>;
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
      : isOrganizationContext(context)
        ? buildOrganizationNavigation(context)
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
      currentOrganizationName={context.currentOrganization?.name ?? null}
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
