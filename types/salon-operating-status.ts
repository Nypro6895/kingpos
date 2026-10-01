export type SalonOperatingStatusKind =
  | "closed"
  | "closed_today"
  | "hours_unset"
  | "open"
  | "permanently_closed"
  | "special_closure";

export type SalonOperatingStatusTone =
  | "closed"
  | "danger"
  | "muted"
  | "open"
  | "special";

export type SalonOperatingStatus = {
  checkedAt: string;
  closesAtLocal: string | null;
  detail: string | null;
  isOpen: boolean;
  kind: SalonOperatingStatusKind;
  label: string;
  localDate: string;
  nextOpensAtLocal: string | null;
  nextOpensLabel: string | null;
  reason: string | null;
  source: "lifecycle" | "special_hours" | "unset" | "weekly_hours";
  timeZone: string;
  tone: SalonOperatingStatusTone;
};

export type SalonOperatingHoursWindow = {
  closesAtLocal: string;
  dayOfWeek: number;
  id?: string;
  opensAtLocal: string;
  sortOrder?: number;
};

export type SalonSpecialHoursStatus = "closed" | "custom_hours";

export type SalonSpecialHours = {
  closesAtLocal: string | null;
  id: string;
  localDate: string;
  opensAtLocal: string | null;
  reason: string | null;
  status: SalonSpecialHoursStatus;
};

export type SalonOperatingStatusInput = {
  lifecycleStatus?: string | null;
  now?: Date | string;
  specialHours: SalonSpecialHours[];
  timeZone?: string | null;
  weeklyHours: SalonOperatingHoursWindow[];
};

export type SalonOperatingHoursSettings = {
  specialHours: SalonSpecialHours[];
  status: SalonOperatingStatus;
  timeZone: string;
  weeklyHours: SalonOperatingHoursWindow[];
};

export type UpdateSalonOperatingHoursInput = {
  timeZone: string;
  weeklyHours: SalonOperatingHoursWindow[];
};

export type CreateSalonSpecialHoursInput = {
  closesAtLocal?: string | null;
  localDate: string;
  opensAtLocal?: string | null;
  reason?: string | null;
  status: SalonSpecialHoursStatus;
};
