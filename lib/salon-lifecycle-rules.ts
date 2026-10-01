export const SALON_LIFECYCLE_STATUSES = [
  "active",
  "disabled",
  "permanently_closed",
] as const;

export type SalonLifecycleStatus = (typeof SALON_LIFECYCLE_STATUSES)[number];

export type StoredSalonLifecycleStatus = SalonLifecycleStatus | "inactive";

export const SALON_OPERATIONS = [
  "VIEW_HISTORY",
  "EXPORT_DATA",
  "CREATE_BOOKING",
  "CREATE_POS_TICKET",
  "MANAGE_CUSTOMERS",
  "MANAGE_PAYROLL",
  "MANAGE_PROFILE",
  "MANAGE_SALON",
  "MANAGE_SERVICES",
  "MANAGE_SETTINGS",
  "MANAGE_STAFF",
] as const;

export type SalonOperation = (typeof SALON_OPERATIONS)[number];

const ACTIVE_OPERATIONS = new Set<SalonOperation>(SALON_OPERATIONS);

const DISABLED_OPERATIONS = new Set<SalonOperation>([
  "EXPORT_DATA",
  "MANAGE_PROFILE",
  "MANAGE_SALON",
  "MANAGE_SETTINGS",
  "VIEW_HISTORY",
]);

const PERMANENTLY_CLOSED_OPERATIONS = new Set<SalonOperation>([
  "EXPORT_DATA",
  "VIEW_HISTORY",
]);

const OPERATIONS_BY_STATUS: Record<SalonLifecycleStatus, Set<SalonOperation>> = {
  active: ACTIVE_OPERATIONS,
  disabled: DISABLED_OPERATIONS,
  permanently_closed: PERMANENTLY_CLOSED_OPERATIONS,
};

const PERMISSION_OPERATION_MAP = new Map<string, SalonOperation>([
  ["booking.manage", "CREATE_BOOKING"],
  ["customers.manage", "MANAGE_CUSTOMERS"],
  ["financial_corrections.apply", "MANAGE_PAYROLL"],
  ["financial_corrections.request", "MANAGE_PAYROLL"],
  ["payroll.manage", "MANAGE_PAYROLL"],
  ["payroll.tax_company", "MANAGE_PAYROLL"],
  ["salon_profile.content.manage", "MANAGE_PROFILE"],
  ["salon_profile.manage", "MANAGE_PROFILE"],
  ["salon_settings.manage", "MANAGE_SETTINGS"],
  ["services.manage", "MANAGE_SERVICES"],
  ["staff.manage", "MANAGE_STAFF"],
  ["tickets.manage", "CREATE_POS_TICKET"],
  ["tickets.void", "CREATE_POS_TICKET"],
]);

export function normalizeSalonLifecycleStatus(
  status: string | null | undefined,
): SalonLifecycleStatus {
  if (status === "active") {
    return "active";
  }

  if (status === "permanently_closed") {
    return "permanently_closed";
  }

  return "disabled";
}

export function isActiveSalonLifecycle(status: string | null | undefined) {
  return normalizeSalonLifecycleStatus(status) === "active";
}

export function isHistoricalSalonLifecycle(status: string | null | undefined) {
  return normalizeSalonLifecycleStatus(status) !== "active";
}

export function canPerformSalonOperation(input: {
  operation: SalonOperation;
  status: string | null | undefined;
}) {
  return OPERATIONS_BY_STATUS[
    normalizeSalonLifecycleStatus(input.status)
  ].has(input.operation);
}

export function getSalonOperationForPermissionCode(
  permissionCode: string | null | undefined,
): SalonOperation | null {
  if (!permissionCode) {
    return null;
  }

  return PERMISSION_OPERATION_MAP.get(permissionCode) ?? null;
}

export function getSalonLifecycleDenialMessage(input: {
  operation: SalonOperation;
  salonName?: string | null;
  status: string | null | undefined;
}) {
  const label = input.salonName?.trim() || "This salon";
  const status = normalizeSalonLifecycleStatus(input.status);

  if (status === "permanently_closed") {
    return `${label} is permanently closed and is available in read-only history mode.`;
  }

  return `${label} is disabled and cannot accept new operational activity right now.`;
}
