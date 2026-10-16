"use client";
import{useEffect}from"react";
import Link from"next/link";
import{WorkspaceText}from"@/components/workspace-language";
import{AppLocalShowcaseLook}from"@/components/app-local-showcase-look";
import{AppLocalTransformations}from"@/components/app-local-transformations";
import{AppLocalVisitView}from"@/components/app-local-visit";
import{getExploreShowcaseLookPage}from"./explore-showcase-content";
import{useAppLocalResource}from"./app-local-resource";
import type{AppLocalPage,AppLocalPageProps}from"./app-local-page-registry";
import type{AppLocalTransformations as TransformationsData,AppLocalVisit}from"./app-local-secondary-metadata";
const uuid=/^[a-f0-9-]{36}$/i;
export function appLocalRouteAlias(path:string):string|null{
 const url=new URL(path,"https://reylumi.com");
 const target:Record<string,string>={"/bookings":"/pos/book","/reports":"/pos/report","/pos-tickets":"/pos/ticket","/businesses/create":"/salons/new"};
 if(target[url.pathname])return target[url.pathname]+url.search;
 if(url.pathname==="/explore/wisconsin"){
  const query=new URLSearchParams({location:url.searchParams.get("city")&&url.searchParams.get("city")!=="All"?`${url.searchParams.get("city")!.slice(0,160)}, WI`:"WI",scope:"fixed"});
  if(url.searchParams.get("q")?.trim())query.set("q",url.searchParams.get("q")!.trim().slice(0,200));
  const category=url.searchParams.get("category");if(category&&["Nails","Hair","Massage","Tattoo","Lashes"].includes(category))query.set("category",category);
  return"/explore?"+query;
 }
 return null;
}
function RedirectPage({path,context,navigate}:AppLocalPageProps){
 const destination=path==="/"?context?.home??(context?.access?.ownerWorkspace?"/staff/today":context?.access?.staffWorkspace?"/staff/my-work":"/explore"):appLocalRouteAlias(path);
 useEffect(()=>{if(destination&&(path!=="/"||context))navigate(destination);},[destination,path,context,navigate]);
 return <main className="p-6" aria-busy="true"><h1 className="text-2xl font-semibold">Reylumi</h1></main>;
}
function ShowcasePage({path}:AppLocalPageProps){const look=getExploreShowcaseLookPage(decodeURIComponent(new URL(path,"https://reylumi.com").pathname.split("/").at(-1)!));return look?<AppLocalShowcaseLook look={look}/>:<main className="p-6"><h1>This look is no longer available.</h1></main>;}
const moreContent:Record<string,{actionHref:string;actionLabel:string;description:string}>={
 memberships:{actionHref:"/explore",actionLabel:"Browse salons",description:"Customer memberships will appear here when they are available for your account."},
 reviews:{actionHref:"/explore",actionLabel:"Explore salons",description:"Reviews posted from your customer account will appear here."},
 "gift-cards":{actionHref:"/more",actionLabel:"Back to More",description:"Gift card balances and history will appear here when they are available."},
 reports:{actionHref:"/notifications",actionLabel:"Open notifications",description:"Support updates tied to your customer account will appear here when they are available."},
};
function StaticMorePage({path,context}:AppLocalPageProps){
 if(!context?.context.authenticated)return <main className="p-6"><Link href={`/login?next=${encodeURIComponent(path)}`}>Sign in to view your account.</Link></main>;
 const content=moreContent[new URL(path,"https://reylumi.com").pathname.split("/").at(-1)!];
 return <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8"><div className="mx-auto grid w-full max-w-3xl gap-5"><Link className="w-fit rounded-full px-2 py-1 text-sm font-bold text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange" href="/more"><WorkspaceText text="Back to More"/></Link><section className="content-surface grid gap-4 border-border-subtle bg-surface px-5 py-8 text-center rounded-none border-y shadow-none"><p className="mx-auto max-w-md text-sm leading-6 text-text-secondary">{content.description}</p><Link className="mx-auto inline-flex min-h-11 items-center justify-center rounded-full bg-brand-orange px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#ef5d28] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange" href={content.actionHref}><WorkspaceText text={content.actionLabel}/></Link></section></div></main>;
}
function SecondaryPage({path,context,navigate}:AppLocalPageProps){
 const url=new URL(path,"https://reylumi.com"),directory=url.pathname.startsWith("/explore/wisconsin/"),visit=url.pathname.startsWith("/notifications/visits/"),id=url.pathname.split("/").at(-1)!,name=directory?"public.directory":visit?"customer.visit":"owner.transformations",args=directory?{businessId:id}:visit?{visitId:id}:{};
 const resource=useAppLocalResource<AppLocalVisit|TransformationsData|{href:string}>(context?.context.scope,name,args);
 const href=directory?(resource.data as {href?:string}|undefined)?.href:undefined;
 useEffect(()=>{if(href)navigate(href);},[href,navigate]);
 const title=directory?"Salon":visit?"Salon visit":"Client transformations";
 if(!resource.data||directory)return <main className="p-6"><h1 className="text-2xl font-semibold">{title}</h1>{resource.error?<><p role="alert">{resource.error}</p><button onClick={()=>void resource.refresh()}>Try again</button></>:<p role="status">Opening…</p>}</main>;
 if(visit)return <AppLocalVisitView data={resource.data as AppLocalVisit}/>;
 const data=resource.data as TransformationsData;return <AppLocalTransformations requests={data.requests} salonName={data.salonName} error={url.searchParams.get("error")??undefined} notice={url.searchParams.get("notice")??undefined}/>;
}
export function getAppLocalSecondaryPage(path:string):AppLocalPage|null{
 try{
  if(!path.startsWith("/")||path.startsWith("//")||/[\\\u0000-\u001f]/.test(path))return null;
  const url=new URL(path,"https://reylumi.com");if(url.hash||[...url.searchParams].some(([key,value])=>/token|secret|password|payment/i.test(key)||value.length>512))return null;
  if(url.pathname==="/"||appLocalRouteAlias(path))return{id:"alias",title:"Reylumi",requiresContext:url.pathname==="/",Component:RedirectPage,features:["equivalent-original-destination"]};
  if(Object.hasOwn(moreContent,url.pathname.replace(/^\/more\//,"")))return{id:"more.static",title:"More",requiresContext:true,Component:StaticMorePage,features:["complete-existing-static-content","no-content-network-request"]};
  if(/^\/explore\/looks\/[a-z0-9-]{1,100}$/i.test(url.pathname))return{id:"showcase.look",title:"Explore look",requiresContext:false,Component:ShowcasePage,features:["complete-bundled-catalog-and-view"]};
  if(url.pathname==="/salon-profile/client-transformations"||url.pathname.startsWith("/notifications/visits/")&&uuid.test(url.pathname.split("/").at(-1)!)||/^\/explore\/wisconsin\/[a-z0-9-]{1,100}$/i.test(url.pathname))return{id:"secondary:"+url.pathname,title:url.pathname.includes("notifications")?"Salon visit":"Salon",requiresContext:true,Component:SecondaryPage,features:["complete-original-view","original-server-ownership","scoped-retained-read"]};
  return null;
 }catch{return null;}
}
