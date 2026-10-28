"use client";
import{createContext,useContext,type ReactNode}from"react";
import{normalizeExploreFeedDiscoveryOptions,type ExploreFeedDiscoveryOptions}from"@/lib/explore-feed-discovery";
import type{ExploreFeedPage}from"@/types/explore";
type Initial={viewerId:string;signature:string;page:ExploreFeedPage;checkedAt:number};
const InitialEditorial=createContext<Initial|null>(null);
function signature(value:ExploreFeedDiscoveryOptions){return JSON.stringify(normalizeExploreFeedDiscoveryOptions({...value,category:value.category==="All"?"":value.category}));}
export function ExploreInitialEditorialProvider({viewerId,discovery,page,checkedAt,children}:{viewerId:string|null|undefined;discovery:ExploreFeedDiscoveryOptions;page:ExploreFeedPage|undefined;checkedAt:number;children:ReactNode}){
 const usable=viewerId&&page?.sessionCursor&&!page.error&&Array.isArray(page.items)&&page.items.length<=12;
 return <InitialEditorial.Provider value={usable?{viewerId,signature:signature(discovery),page,checkedAt}:null}>{children}</InitialEditorial.Provider>;
}
export function useExploreInitialEditorial(discovery:ExploreFeedDiscoveryOptions,viewerId:string|null){
 const initial=useContext(InitialEditorial);
 return initial&&initial.viewerId===viewerId&&initial.signature===signature(discovery)&&initial.checkedAt<=Date.now()&&Date.now()-initial.checkedAt<30_000?initial.page:undefined;
}
