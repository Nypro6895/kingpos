export type PayrollIssuedCheck = { id: string; staffId: string; number: string; periodStart: string; periodEnd: string };
export type PayrollIssuedChecks = { status: "available"; checks: PayrollIssuedCheck[] } | { status: "unavailable"; checks: [] };
