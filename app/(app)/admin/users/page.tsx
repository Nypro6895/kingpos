import { withExperiencePage } from "@/components/experience-page";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { searchPlatformAdminUsers } from "@/lib/platform-admin/users";
import { adminIdentityReady } from "@/lib/platform-admin/user-identity";
import { UsersWorkspace } from "./users-workspace";
import type { UserDrawerTab } from "@/types/admin-users-workspace";
type Props={searchParams:Promise<Record<string,string|string[]|undefined>>};
async function AdminUsersPage({searchParams}:Props) {
 const context=await requirePlatformAdmin(P.usersRead);const rawParams=await searchParams;const params:Record<string,string|string[]|undefined>={...rawParams,status:rawParams.status??"active"};
 const users=await searchPlatformAdminUsers({...params,pageSize:params.pageSize??'50'});
 const query=Object.fromEntries(['q','status','role','businessId','sort','pageSize'].map(key=>{const value=params[key];return [key,Array.isArray(value)?value[0]:value];}));
 const userId=typeof params.user==='string'&&/^[0-9a-f-]{36}$/i.test(params.user)?params.user:undefined;
 const tab=typeof params.tab==='string'&&['profile','access','security','activity'].includes(params.tab)?params.tab as UserDrawerTab:undefined;
 return <UsersWorkspace users={users} context={context} query={query} initialUserId={userId} initialTab={tab} identityReady={adminIdentityReady()}/>;
}

export default withExperiencePage(AdminUsersPage, { admin: true });
