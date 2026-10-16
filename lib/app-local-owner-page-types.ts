import type { BookingSetupData } from "./booking-setup";
import type { StaffDirectoryMember } from "./staff";
import type { StaffAccountExactSearchResult, SalonStaffConnectionRequestWithDetails } from "@/types/staff-salon-connection";
import type { getManagedStaffOfflineBinding } from "./staff-offline-binding-server";
import type { CustomerDetailData, CustomerListItem, CustomerListPagination } from "./customers";
import type { BeautyProfileResolveResult } from "./beauty-relationship";
import type { Customer } from "@/types/customer";
import type { getPayrollPageData } from "./payroll";
import type { taxCompanySettings } from "./tax-company";

export type AppLocalOwnerStaffParams = { add?: string; connection_error?: string; connection_notice?: string; error?: string; filter?: string; invite_email?: string; invite_phone?: string; invite_request?: string; invite_token?: string; q?: string; setup?: string; staff?: string };
export type AppLocalOwnerStaffData = {
  canViewStaff: boolean; canManageStaff: boolean; canManagePayroll: boolean; canBecomeStaff: boolean;
  directory: { staff: StaffDirectoryMember[] }; bookingSetup: BookingSetupData;
  connectionRequests: SalonStaffConnectionRequestWithDetails[];
  lookupResult: StaffAccountExactSearchResult | null; lookupError: string | null;
  offlineBinding: Awaited<ReturnType<typeof getManagedStaffOfflineBinding>>; experienceScope: string;
};
export type AppLocalOwnerCustomersData = { customers: CustomerListItem[]; pagination: CustomerListPagination; canManageCustomers: boolean };
export type AppLocalOwnerCustomerDetailData = { data: CustomerDetailData; beautyProfileResult: BeautyProfileResolveResult | null; canManageCustomers: boolean };
export type AppLocalOwnerCustomerFormData = { customer?: Customer; canManageCustomers: true };
export type AppLocalOwnerPayrollParams = { end?: string; month?: string; overviewRange?: string; overviewService?: string; overviewServiceRank?: string; overviewStaff?: string; overviewTrend?: string; payPeriodStart?: string; payroll_error?: string; editStaff?: string; preset?: string; segment?: string; start?: string; tab?: string };
export type AppLocalOwnerPayrollData = { payroll: Omit<Awaited<ReturnType<typeof getPayrollPageData>>, "context">; salonId: string; salonName: string; canManageConnection: boolean; taxPlugin: Awaited<ReturnType<typeof taxCompanySettings>> | null; downloadEnabled: boolean };
