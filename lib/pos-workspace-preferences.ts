export const DEFAULT_WORKSPACE_PREFERENCES = {
  showStaff: true, showServices: true, showCustomer: true, showTip: true, showDiscount: true,
  idleMinutes: 3, idleWarningSeconds: 60,
  serviceCategoriesEnabled: false,
  serviceCategoryColors: {} as Record<string, string>,
};
export type PosWorkspacePreferences = typeof DEFAULT_WORKSPACE_PREFERENCES;
export function normalizeWorkspacePreferences(value: unknown): PosWorkspacePreferences {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_WORKSPACE_PREFERENCES };
  for (const key of ["showStaff", "showServices", "showCustomer", "showTip", "showDiscount", "serviceCategoriesEnabled"] as const)
    if (typeof input[key] === "boolean") result[key] = input[key];
  for (const [key, min, max] of [["idleMinutes", 1, 60], ["idleWarningSeconds", 15, 300]] as const)
    if (Number.isInteger(input[key]) && Number(input[key]) >= min && Number(input[key]) <= max) result[key] = Number(input[key]);
  if (input.serviceCategoryColors && typeof input.serviceCategoryColors === "object" && !Array.isArray(input.serviceCategoryColors)) {
    result.serviceCategoryColors = Object.fromEntries(Object.entries(input.serviceCategoryColors).filter(([name, color]) => name.trim() && typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)));
  }
  return result;
}
