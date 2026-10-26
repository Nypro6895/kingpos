"use client";

import { type ReactNode } from "react";
import { AppLocalTicketDetail } from "@/components/app-local-ticket-detail";
import { OwnerPosNavigation } from "@/app/pos/owner-pos-tabs";
import { AppLocalTaxSalons, AppLocalTaxReport, AppLocalTaxInstall } from "@/components/app-local-tax-company";
import { getAppLocalHost } from "./app-local-host";
import { useAppLocalResource } from "./app-local-resource";
import type { AppLocalPage, AppLocalPageProps } from "./app-local-page-registry";
import type { AppLocalTicketDetailData, AppLocalTaxSalonsData, AppLocalTaxReportData } from "./app-local-daily-metadata";

function ReadView<T>({ name, args, title, children, ...props }: AppLocalPageProps & { name: string; args: Record<string, unknown>; title: string; children: (data: T) => ReactNode }) {
  const scope = props.context?.context.authenticated ? props.context.context.scope : undefined;
  const resource = useAppLocalResource<T>(scope, name, args, { enabled: Boolean(scope) });
  if (!scope) return <main className="p-6"><h1 className="text-2xl font-semibold">{title}</h1><p className="mt-4">Sign in to view this page.</p><button className="mt-4 rounded border px-4 py-2" onClick={() => void (props.host ?? getAppLocalHost()).openOnline(`/login?next=${encodeURIComponent(props.path)}`)}>Sign in</button></main>;
  if (resource.data) return children(resource.data);
  return <main className="p-6" aria-busy={resource.loading || resource.refreshing}><h1 className="text-2xl font-semibold">{title}</h1>{resource.error ? <><p className="mt-4" role="alert">{resource.error}</p><button className="mt-4 rounded border px-4 py-2" onClick={() => void resource.refresh()}>Try again</button></> : <p className="mt-4" role="status">Opening…</p>}</main>;
}
function TicketPage(props: AppLocalPageProps) {
  const url = new URL(props.path, "https://reylumi.com"), ticketId = url.pathname.split("/").at(-1)!;
  const owner = props.context?.grant?.kind === "owner" || Boolean(props.context && !props.context.offline && props.context.access?.ownerWorkspace);
  const ownerScope = `owner:${props.context?.context.salonId}:${props.context?.context.viewerId}`;
  return <>
    {url.pathname.startsWith("/pos/ticket/") && owner ? <OwnerPosNavigation active="ticket" syncScope={ownerScope} /> : null}
    <ReadView<AppLocalTicketDetailData> {...props} title="POS Ticket" name="owner.ticket-detail" args={{ ticketId }}>{data => <AppLocalTicketDetail key={`${props.context?.context.scope}:${ticketId}`} data={data} error={url.searchParams.get("error") ?? undefined} />}</ReadView>
  </>;
}
function TaxPage(props: AppLocalPageProps) {
  const url = new URL(props.path, "https://reylumi.com"), salonId = url.pathname.split("/")[2], query = { message: url.searchParams.get("message") ?? undefined };
  if (!salonId) return <ReadView<AppLocalTaxSalonsData> {...props} title="Tax Company" name="customer.tax-salons" args={{}}>{salons => <AppLocalTaxSalons key={props.context?.context.scope} salons={salons} query={query} />}</ReadView>;
  const args: Record<string, unknown> = { salonId }; for (const key of ["run", "period"]) if (url.searchParams.has(key)) args[key] = url.searchParams.get(key)!;
  return <ReadView<AppLocalTaxReportData> {...props} title="Tax payroll" name="customer.tax-report" args={args}>{data => <AppLocalTaxReport key={`${props.context?.context.scope}:${salonId}`} data={data} salonId={salonId} query={query} />}</ReadView>;
}
const ticket: AppLocalPage = { id: "owner.ticket-detail", title: "POS Ticket", requiresContext: true, Component: TicketPage, features: ["complete-original-ticket-detail", "receipt", "timeline", "original-permission-based-forms", "original-server-confirmations"] };
const tax: AppLocalPage = { id: "customer.tax-company", title: "Tax Company", requiresContext: true, Component: TaxPage, features: ["complete-original-salon-list", "original-periods-and-report", "original-note-version-check", "online-connection-authority", "no-durable-paystub-capabilities"] };
const install: AppLocalPage = { id: "tax-company.install", title: "Install Reylumi Tax Company", requiresContext: false, Component: AppLocalTaxInstall, features: ["complete-original-install-instructions"] };
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
export function getAppLocalDailyPage(path: string): AppLocalPage | null {
  try {
    if (!path.startsWith("/") || path.startsWith("//") || /\\|%2f|%5c|%00/i.test(path) || path.length > 4096) return null;
    const url = new URL(path, "https://reylumi.com"), pathname = url.pathname.replace(/\/$/, "");
    const ticketPath = new RegExp(`^/(?:pos-tickets|pos/ticket)/${uuid}$`, "i").test(pathname), taxPath = pathname === "/tax-company" || new RegExp(`^/tax-company/${uuid}$`, "i").test(pathname);
    const allowed = ticketPath ? ["error"] : taxPath ? ["run", "period", "message"] : [];
    if ([...url.searchParams].some(([key, value]) => !allowed.includes(key) || value.length > 512 || url.searchParams.getAll(key).length !== 1)) return null;
    if (ticketPath) return ticket;
    if (taxPath) return tax;
    if (pathname === "/tax-company/install") return install;
    return null;
  } catch { return null; }
}
