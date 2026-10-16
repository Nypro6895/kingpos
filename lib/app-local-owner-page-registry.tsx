"use client";
import type { ReactNode } from "react";
import { AppLocalOwnerStaffView } from "./app-local-owner-staff-view";
import { AppLocalOwnerCustomersView } from "./app-local-owner-customers-view";
import { AppLocalOwnerCustomerDetailView } from "./app-local-owner-customer-detail-view";
import { AppLocalOwnerPayrollView } from "./app-local-owner-payroll-view";
import { CustomerForm } from "@/app/customers/customer-form";
import { createCustomer, updateCustomer } from "@/app/customers/actions";
import { WorkspaceText } from "@/components/workspace-language";
import { useAppLocalResource } from "./app-local-resource";
import { getAppLocalHost } from "./app-local-host";
import type { AppLocalPage, AppLocalPageProps } from "./app-local-page-registry";
import type { AppLocalOwnerStaffData, AppLocalOwnerCustomersData, AppLocalOwnerCustomerDetailData, AppLocalOwnerCustomerFormData, AppLocalOwnerPayrollData } from "./app-local-owner-page-types";
import policy from "./app-local-owner-page-registry.json";
import Link from "next/link";

const urlFor = (path: string) => new URL(path, "https://reylumi.com");
const query = (path: string) => Object.fromEntries(urlFor(path).searchParams);
function argsFor(name: keyof typeof policy.reads, path: string) {
  const allowed: readonly string[] = policy.reads[name].argumentKeys;
  return Object.fromEntries(Object.entries(query(path)).filter(([key]) => allowed.includes(key)));
}
function Read<T>({ context, host, path, title, name, args, children }: AppLocalPageProps & { title: string; name: string; args: Record<string, string>; children: (data: T) => ReactNode }) {
  const scope = context?.context.scope;
  const allowed = Boolean(context?.context.authenticated && context.access?.ownerWorkspace);
  const state = useAppLocalResource<T>(scope, name, args, { enabled: allowed });
  if (!allowed) return <main className="mx-auto grid max-w-5xl gap-4 p-6"><h1 className="text-2xl font-semibold"><WorkspaceText text={title} /></h1><p><WorkspaceText text="Open this page from a Business workspace." /></p><button type="button" onClick={() => void (host ?? getAppLocalHost()).openOnline(`/login?next=${encodeURIComponent(path)}`)}><WorkspaceText text="Sign in" /></button></main>;
  if (state.data !== undefined) return children(state.data);
  return <main className="mx-auto grid max-w-5xl gap-4 p-6"><h1 className="text-2xl font-semibold"><WorkspaceText text={title} /></h1>{state.error ? <div role="alert"><p>{state.error}</p><button type="button" onClick={() => void state.refresh()}><WorkspaceText text="Try again" /></button></div> : <p role="status"><WorkspaceText text="Opening…" /></p>}</main>;
}
function StaffPage(props: AppLocalPageProps) { return <Read<AppLocalOwnerStaffData> {...props} title="Staff" name="page.owner-staff" args={argsFor("page.owner-staff", props.path)}>{data => <AppLocalOwnerStaffView data={data} params={query(props.path)} />}</Read>; }
function CustomersPage(props: AppLocalPageProps) { return <Read<AppLocalOwnerCustomersData> {...props} title="Customers" name="page.owner-customers" args={argsFor("page.owner-customers", props.path)}>{data => <AppLocalOwnerCustomersView data={data} params={query(props.path)} />}</Read>; }
function CustomerDetailPage(props: AppLocalPageProps) {
  const args = { customerId: urlFor(props.path).pathname.split("/")[2], ...argsFor("page.owner-customer-detail", props.path) };
  return <Read<AppLocalOwnerCustomerDetailData> {...props} title="Customer" name="page.owner-customer-detail" args={args}>{value => <AppLocalOwnerCustomerDetailView value={value} params={query(props.path)} />}</Read>;
}
function CustomerFormPage(props: AppLocalPageProps) {
  const url = urlFor(props.path), mode = url.pathname === "/customers/new" ? "create" : "edit";
  const args: Record<string, string> = mode === "edit" ? { customerId: url.pathname.split("/")[2] } : {};
  return <Read<AppLocalOwnerCustomerFormData> {...props} title={mode === "edit" ? "Edit customer" : "Create customer"} name="page.owner-customer-form" args={args}>{data => <main className="mx-auto w-full max-w-3xl px-6 py-10"><CustomerForm action={mode === "edit" ? updateCustomer : createCustomer} customer={data.customer} error={url.searchParams.get("error") ?? undefined} mode={mode} /><Link className="mt-6 inline-flex text-sm font-medium text-zinc-950 underline" href={data.customer ? `/customers/${data.customer.id}` : "/customers"}><WorkspaceText text={data.customer ? "Back to Customer" : "Back to Customers"} /></Link></main>}</Read>;
}
function PayrollPage(props: AppLocalPageProps) { return <Read<AppLocalOwnerPayrollData> {...props} title="Payroll" name="page.owner-payroll" args={argsFor("page.owner-payroll", props.path)}>{value => <AppLocalOwnerPayrollView value={value} params={query(props.path)} />}</Read>; }
const pages: Record<string, AppLocalPage> = {
  staff: { id: "owner.staff", title: "Staff", requiresContext: true, Component: StaffPage, features: ["original-directory", "original-requests", "original-approval-and-reconfirmation", "original-detail-drawers"] },
  customers: { id: "owner.customers", title: "Customers", requiresContext: true, Component: CustomersPage, features: ["original-crm-list", "search", "pagination", "original-duplicate-merge"] },
  detail: { id: "owner.customer-detail", title: "Customer", requiresContext: true, Component: CustomerDetailPage, features: ["original-identity", "original-history", "original-relationship", "original-private-notes"] },
  form: { id: "owner.customer-form", title: "Customer", requiresContext: true, Component: CustomerFormPage, features: ["original-form", "original-create-update-authority"] },
  payroll: { id: "owner.payroll", title: "Payroll", requiresContext: true, Component: PayrollPage, features: ["original-overview", "original-staff-shop-income", "original-tax", "original-settings", "original-statement-confirmations"] },
};
/** Sensitive invite/payment callbacks remain on their original HTTPS authority. */
export function getAppLocalOwnerPage(path: string): AppLocalPage | null {
  try {
    if (!path.startsWith("/") || path.startsWith("//") || path.length > 4096 || /\\|%2f|%5c|%00/i.test(path)) return null;
    const url = urlFor(path), pathname = url.pathname.replace(/\/$/, "") || "/";
    if (url.hash || [...url.searchParams].some(([key, value]) => /token|secret|password|pin|signature|authorization|cookie|^code$|^payment$|bookingStripe|checkout|^next$|return_to/i.test(key) || value.length > 512)) return null;
    if (pathname === "/staff") return pages.staff;
    if (pathname === "/customers") return pages.customers;
    if (pathname === "/customers/new") return pages.form;
    if (/^\/customers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/edit$/i.test(pathname)) return pages.form;
    if (/^\/customers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pathname)) return pages.detail;
    if (pathname === "/payroll") return pages.payroll;
    return null;
  } catch { return null; }
}
