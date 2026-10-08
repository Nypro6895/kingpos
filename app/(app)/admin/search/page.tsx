import Link from "next/link";
import { AdminPageHeader, AdminSection, EmptyState, SearchForm } from "../_components/admin-ui";
import { loadOptionalAdminSection, SectionError } from "../_components/optional-section";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { searchPlatformAdminUsers } from "@/lib/platform-admin/users";
import { searchPlatformAdminBusinesses } from "@/lib/platform-admin/businesses";
import { searchPlatformAdminLocations } from "@/lib/platform-admin/locations";
import { searchPlatformAdminReports } from "@/lib/platform-admin/reports";
import { listSupportInbox } from "@/lib/platform-admin/inbox";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";

export default async function AdminSearchPage({ searchParams }: { searchParams:Promise<Record<string,string|string[]|undefined>> }) {
  const context=await requirePlatformAdmin();
  const params=await searchParams;
  const q=typeof params.q==="string" ? params.q.trim() : "";
  const can=(permission:(typeof P)[keyof typeof P])=>context.permissions.includes(permission);
  const [users,businesses,locations,cases,inbox]=q.length>=2 && q.length<=100 ? await Promise.all([
    can(P.usersRead) ? loadOptionalAdminSection(()=>searchPlatformAdminUsers({q,pageSize:"10"})) : null,
    can(P.businessesRead) ? loadOptionalAdminSection(()=>searchPlatformAdminBusinesses({q,pageSize:"10"})) : null,
    can(P.locationsRead) ? loadOptionalAdminSection(()=>searchPlatformAdminLocations({q,pageSize:"10"})) : null,
    can(P.reportsRead) ? loadOptionalAdminSection(()=>searchPlatformAdminReports({q,pageSize:"10"})) : null,
    can(P.inboxRead) ? loadOptionalAdminSection(()=>listSupportInbox({q,pageSize:"10"})) : null,
  ]) : [null,null,null,null,null];
  const sections=[{title:"Users",kind:"users",result:users,items:users?.data?.items.map(item=>({id:item.id,label:item.display_name ?? item.email ?? "Unnamed user",detail:item.status}))},
    {title:"Businesses",kind:"businesses",result:businesses,items:businesses?.data?.items.map(item=>({id:item.id,label:item.name,detail:item.status}))},
    {title:"Locations",kind:"locations",result:locations,items:locations?.data?.items.map(item=>({id:item.id,label:item.name,detail:item.organization_name}))},
    {title:"Support cases",kind:"reports",result:cases,items:cases?.data?.items.map(item=>({id:item.id,label:`${item.report_number} · ${item.summary}`,detail:item.status.replaceAll("_"," ")}))},
    {title:"Support inbox",kind:"inbox",result:inbox,items:inbox?.data?.items.map(item=>({id:item.id,label:item.customer_name,detail:item.preview}))}];
  return <><AdminPageHeader eyebrow="Platform" title="Search">Find users, businesses, locations and support requests within your access.</AdminPageHeader><SearchForm defaultQuery={q} placeholder="Search by name, reference or keyword"/>{q.length<2 ? <div className="mt-6"><EmptyState title="Enter at least two characters"/></div> : q.length>100 ? <div className="mt-6"><EmptyState title="Use 100 characters or fewer"/></div> : sections.filter(section=>section.result).map(section=><AdminSection key={section.kind} title={section.title} action={<Link href={`/admin/${section.kind}?q=${encodeURIComponent(q)}`} className="dashboard-link">View all →</Link>}>{section.result?.error ? <SectionError message={section.result.error}/> : section.items?.length ? <div className="divide-y border-t border-zinc-200 bg-white">{section.items.map(item=><Link key={item.id} href={`/admin/${section.kind}/${item.id}`} className="flex items-center justify-between gap-3 py-4 hover:bg-zinc-50"><span className="text-sm font-semibold">{item.label}</span><span className="text-xs text-zinc-500">{item.detail} →</span></Link>)}</div> : <EmptyState title="No matching records"/>}</AdminSection>)}</>;
}
