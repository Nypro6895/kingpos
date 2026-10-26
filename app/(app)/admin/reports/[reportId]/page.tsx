import { withExperiencePage } from "@/components/experience-page";
import Link from 'next/link';
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS as P} from '@/types/platform-admin';
import {loadAdminReportContext} from '@/lib/platform-admin/report-context';
import {callPlatformAdminRpc} from '@/lib/platform-admin/rpc';
import {ReportCaseView} from '../report-case-view';

async function AdminReportDetailPage({params}:{params:Promise<{reportId:string}>}){
 const actor=await requirePlatformAdmin(P.reportsRead),{reportId}=await params;
 const data=await loadAdminReportContext(reportId);
 const assignees=actor.permissions.includes(P.reportsAssign)?await callPlatformAdminRpc<Array<{id:string;name:string;role:string}>>('get_platform_admin_case_assignees'):[];
 return <><div className="mb-4"><Link className="dashboard-link" href="/admin/reports">← All support cases</Link></div><ReportCaseView data={data} permissions={actor.permissions} membershipId={actor.membershipId} roleSlug={actor.roleSlug} assignees={assignees}/></>;
}

export default withExperiencePage(AdminReportDetailPage, { admin: true });
