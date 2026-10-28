import "server-only";
import type { AppLocalContext, AppLocalRead } from "./app-local-host";
import { readAppLocalRoleResource } from "./app-local-role-resources-server";
import { createHash } from "node:crypto";
import { getRequestBusinessContext } from "./request-business-context";
import { isOwnerMembership } from "./current-context";
import { appLocalPrefetchPlan } from "./app-local-prefetch-plan";
import { readAppLocalExploreResource } from "./app-local-explore-server";
import { getStaffPortalIdentity } from "./staff-portal-identity";

/** Fresh data from the existing readers in this request; never an offline grant.
 * Only fixed initial page reads are permitted, with their original authorization. */
export async function readAppLocalBootstrap(value: AppLocalContext, path: string, readInitial?: (name:string,args:Record<string,unknown>,scope:string)=>Promise<AppLocalRead|null>) {
  if (value.offline || !value.context.authenticated || [401,403,409].includes(value.grantStatus ?? 0)
    || value.offlineState === "unconfirmed") return [];
  if(!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f]/.test(path)) return [];
  const scope = value.context.scope, url = new URL(path, "https://reylumi.com");
  if([...url.searchParams.keys()].some(key=>/token|secret|password|callback|redirect|returnTo/i.test(key)))return [];
  if(url.pathname === "/staff/today" && [...url.searchParams.keys()].some(key=>key!=="date"))return [];
  if(url.pathname === "/staff/my-work" && [...url.searchParams.keys()].some(key=>!["tab","payPeriodStart"].includes(key)))return [];
  const rows: {name:string;args:Record<string,unknown>;value:AppLocalRead}[] = [];
  const add = (name:string,args:Record<string,unknown>,result:AppLocalRead|null) => {
    if(result?.status === 200 && result.scope === scope && result.data !== undefined) rows.push({name,args,value:result});
  };
  if (url.pathname === "/staff/today") {
    const args = url.searchParams.has("date") ? {date:url.searchParams.get("date")!} : {};
    const today = await readAppLocalRoleResource("owner.today",args,{scope});
    if(today?.status === 200 && today.data !== undefined) {
      const context = await getRequestBusinessContext();
      const data = {dashboard:today.data,isOwner:isOwnerMembership(context.currentMembership)};
      add("page.owner-today",args,{...today,data,etag:'"bootstrap-'+createHash("sha256").update(JSON.stringify([scope,"page.owner-today",args,data])).digest("hex")+'"'});
    }
  } else if (url.pathname === "/staff/my-work") {
    const identity = await getStaffPortalIdentity();
    if (identity.staff && identity.context.user?.id === value.context.viewerId) {
      const args = {staffId:identity.staff.id,...Object.fromEntries(["tab","payPeriodStart"].filter(key=>url.searchParams.has(key)).map(key=>[key,url.searchParams.get(key)!]))};
      add("staff.my-work",args,await readAppLocalRoleResource("staff.my-work",args,{scope}));
    }
  } else if(url.pathname === "/staff/appointments") {
    const allowed=["range","status","bookingId","date","quickId","view"];
    if([...url.searchParams.keys()].some(key=>!allowed.includes(key)))return [];
    const identity=await getStaffPortalIdentity();
    if(identity.staff && identity.context.user?.id===value.context.viewerId) {
      const args={staffId:identity.staff.id,...Object.fromEntries(allowed.filter(key=>url.searchParams.has(key)).map(key=>[key,url.searchParams.get(key)!]))};
      add("staff.schedule",args,await readAppLocalRoleResource("staff.schedule",args,{scope}));
    }
  } else if(url.pathname === "/staff/workday" && !url.search && readInitial) {
    // Attendance retains its own original identity and fresh final checks.
    const identity=await readInitial("page.staff-identity",{view:"workday"},scope);
    const details=identity?.data as {resourceScope?:string;staffId?:string}|undefined;
    if(identity?.status===200 && identity.scope===scope && details?.resourceScope===scope && details.staffId) {
      add("page.staff-identity",{view:"workday"},identity);
      const args={staffId:details.staffId};
      add("staff.workday",args,await readAppLocalRoleResource("staff.workday",args,{scope}));
    }
  } else if (url.pathname === "/explore" && !url.search) {
    const args = {query:""};
    const results = await Promise.all(["page.explore","page.explore-feed"].map(async name => ({name,result:await readAppLocalExploreResource(name,args,{scope})})));
    for(const {name,result} of results) add(name,args,result);
    const core = rows.find(row=>row.name === "page.explore"), feed = rows.find(row=>row.name === "page.explore-feed");
    const coreData = core?.value.data as {deferred?:Record<string,unknown>}|undefined;
    const feedData = feed?.value.data as {items?:unknown[]}|undefined;
    if(core && coreData?.deferred && feedData && Array.isArray(feedData.items)) {
      // The feed is already freshly hydrated for this same viewer. Supply it as
      // the initial page, avoiding an unnecessary client Suspense promise cycle.
      const data = {...coreData,initialFeed:feedData,deferred:{...coreData.deferred,feed:false}};
      core.value = {...core.value,data,etag:'"bootstrap-'+createHash("sha256").update(JSON.stringify([scope,core.name,args,data])).digest("hex")+'"'};
    }
  } else if(readInitial) {
    // Only the shared plan's exact current-page contract; never speculative
    // pages, arbitrary endpoints, edit flows or command-shaped operations.
    const jobs = appLocalPrefetchPlan(value,path).filter(job=>job.path === path).slice(0,2);
    const loaded = await Promise.all(jobs.map(async job=>({job,result:await readInitial(job.name,job.args,scope)})));
    for(const {job,result} of loaded) add(job.name,job.args,result);
  }
  return rows;
}
