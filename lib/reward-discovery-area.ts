import {parseExploreQueryArea,exploreQueryStateCode} from "@/lib/explore-query-intent";
/** The selected public city/state or US ZIP is already an explicit scope.
 * Do not resolve it by selecting owner-protected location rows as anon.
 */
export function rewardDiscoveryArea(input:string){
 const value=input.trim().replace(/\s+/g," ").replace(/,\s*(US|USA|United States(?: of America)?)$/i,"");
 if(!value||value.length>160||/[%_]/.test(value))return null;
 const postal=value.match(/^(\d{5})(?:-\d{4})?(?:,?\s+([a-z]{2}))?$/i);
 if(postal){const state=postal[2]?exploreQueryStateCode(postal[2]):"";if(postal[2]&&!state)return null;return{city:null,state:state||null,postal:postal[1],country:"US",label:`ZIP ${postal[1]}${state?`, ${state}`:""}`};}
 const area=parseExploreQueryArea(value);
 if(area?.kind!=="city"||!area.city||!area.stateCode)return null;
 return{city:area.city,state:area.stateCode,postal:null,country:"US",label:`${area.city}, ${area.stateCode}`};
}
