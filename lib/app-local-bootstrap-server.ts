import "server-only";
import type { AppLocalContext, AppLocalRead } from "./app-local-host";
import { readAppLocalRoleResource } from "./app-local-role-resources-server";
import { readAppLocalExploreResource } from "./app-local-explore-server";
import { getStaffPortalIdentity } from "./staff-portal-identity";

/** Fresh data from the existing readers in this request; never an offline grant.
 * Only fixed initial page reads are permitted, with their original authorization. */
export async function readAppLocalBootstrap(value: AppLocalContext, path: string) {
  if (value.offline || !value.context.authenticated || [401,403,409].includes(value.grantStatus ?? 0)
    || value.offlineState === "unconfirmed") return [];
  const scope = value.context.scope, url = new URL(path, "https://reylumi.com");
  const rows: {name:string;args:Record<string,unknown>;value:AppLocalRead}[] = [];
  const add = (name:string,args:Record<string,unknown>,result:AppLocalRead|null) => {
    if(result?.status === 200 && result.scope === scope && result.data !== undefined) rows.push({name,args,value:result});
  };
  if (url.pathname === "/staff/today") {
    const args = url.searchParams.has("date") ? {date:url.searchParams.get("date")!} : {};
    add("owner.today",args,await readAppLocalRoleResource("owner.today",args,{scope}));
  } else if (url.pathname === "/staff/my-work") {
    const identity = await getStaffPortalIdentity();
    if (identity.staff && identity.context.user?.id === value.context.viewerId) {
      const args = {staffId:identity.staff.id,...Object.fromEntries(["tab","payPeriodStart"].filter(key=>url.searchParams.has(key)).map(key=>[key,url.searchParams.get(key)!]))};
      add("staff.my-work",args,await readAppLocalRoleResource("staff.my-work",args,{scope}));
    }
  } else if (url.pathname === "/explore" && !url.search) {
    const args = {query:""};
    const results = await Promise.all(["page.explore","page.explore-feed"].map(async name => ({name,result:await readAppLocalExploreResource(name,args,{scope})})));
    for(const {name,result} of results) add(name,args,result);
  }
  return rows;
}
