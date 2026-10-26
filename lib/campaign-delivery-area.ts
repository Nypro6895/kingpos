import { cleanExploreQueryText, exploreQueryStateCode, parseExploreQueryArea } from '@/lib/explore-query-intent';

export type CampaignDeliveryArea = {country:string;state:string;city:string;zipcode:string;neighborhood:string};
export type CampaignPlace = {country:string|null;state:string|null;city:string|null;postal_code:string|null};
type Point = {latitude:number;longitude:number};
type GpsArea = {country:string;state:string;city:string|null;postalCode:string|null};
type Selection = CampaignDeliveryArea & {level:'city'|'state'|'country'|'zipcode'|'neighborhood'};
const text=(value:string|null|undefined)=>(value??'').trim();
const same=(a:string,b:string)=>a.toLocaleLowerCase()===b.toLocaleLowerCase();
function country(value:string|null|undefined){const v=text(value);return /^(us|usa|u\.s\.?a?\.?|united states(?: of america)?)$/i.test(v)?'US':/^canada$/i.test(v)?'CA':/^(united kingdom|uk)$/i.test(v)?'GB':/^[a-z]{2}$/i.test(v)?v.toUpperCase():v;}
function state(value:string|null|undefined,countryValue?:string|null){return countryValue&&country(countryValue)!=='US'?text(value):exploreQueryStateCode(text(value))||text(value);}
function zip(value:string){return /^\d{5}-\d{4}$/.test(value)?value.slice(0,5):value;}
function point(latitude:unknown,longitude:unknown):Point|null{return typeof latitude==='number'&&typeof longitude==='number'&&Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180?{latitude,longitude}:null;}

/** A query is also the response scope: an ad from an earlier GPS point cannot leak into a new selection. */
export function campaignDeliveryRequest(location:string|undefined,latitude?:number|null,longitude?:number|null,query?:string){
 const search=cleanExploreQueryText(query);
 const label=text(location);if(label.length>160||/[\x00-\x1f]/.test(label))return null;
 const gps=point(latitude,longitude);if(!label&&!gps)return null;
 const params=new URLSearchParams();if(label)params.set('location',label);if(search)params.set('query',search);
 const key=JSON.stringify([label,gps?.latitude??null,gps?.longitude??null,search]);
 // Exact GPS coordinates stay in a private POST body, never a URL/access-log key.
 return gps?{key,url:'/api/campaigns/delivery',body:JSON.stringify({kind:'select',location:label,...gps,...(search?{query:search}:{})})}:{key,url:`/api/campaigns/delivery?${params}`,body:undefined};
}

function selection(label:string):Selection|null{
 const parts=label.split(',').map(x=>x.trim());if(parts.length>4||parts.some(x=>!x))return null;
 const result:Selection={country:'',state:'',city:'',zipcode:'',neighborhood:'',level:'city'};
 let place=parts[0];
 if(parts.length===4){result.neighborhood=parts[0];place=parts[1];result.country=country(parts[3]);result.state=state(parts[2],result.country);result.level='neighborhood';}
 else if(parts.length===3){result.country=country(parts[2]);result.state=state(parts[1],result.country);}
 else if(parts.length===2){const firstState=exploreQueryStateCode(parts[0]);if(firstState){result.country=country(parts[1]);result.state=state(parts[0],result.country);result.level='state';return result;}if(exploreQueryStateCode(parts[1]))result.state=state(parts[1]);else if(['US','CA','GB'].includes(country(parts[1])))result.country=country(parts[1]);else result.state=state(parts[1]);}
 else {const area=parseExploreQueryArea(place);if(area?.kind==='state'){result.state=area.stateCode;result.level='state';return result;}const c=country(place);if(['US','CA','GB'].includes(c)){result.country=c;result.level='country';return result;}if(area?.kind==='city'){place=area.city;result.state=area.stateCode;}}
 if(result.level!=='neighborhood'&&/^[a-z0-9 -]{3,12}$/i.test(place)&&/\d/.test(place)){result.zipcode=zip(place);result.level='zipcode';}
 else result.city=place;
 return result;
}

/** Never infer a ZIP from a city, nearest salon, or centroid. GPS enrichment must agree with the selected area. */
export async function resolveCampaignDeliveryArea(input:{location?:string;latitude?:number|null;longitude?:number|null},options:{lookup:(field:'city'|'state'|'country'|'postal_code',value:string)=>Promise<CampaignPlace[]>;reverse:(point:Point)=>Promise<GpsArea|null>}):Promise<CampaignDeliveryArea|null>{
 const label=text(input.location);if(label.length>160||/[\x00-\x1f]/.test(label))return null;
 const selected=label?selection(label):null;if(label&&!selected)return null;
 const gps=point(input.latitude,input.longitude);
 if(gps&&(!selected||!['country','state','neighborhood'].includes(selected.level))){
  const resolved=await options.reverse(gps).catch(()=>null);
  if(resolved){const area:CampaignDeliveryArea={country:country(resolved.country),state:state(resolved.state,resolved.country),city:text(resolved.city),zipcode:zip(text(resolved.postalCode)),neighborhood:''};
   if(area.country&&area.state&&(!selected||(!selected.country||same(selected.country,area.country))&&(!selected.state||same(selected.state,area.state))&&(!selected.city||same(selected.city,area.city))&&(!selected.zipcode||same(selected.zipcode,area.zipcode))))return {...area,neighborhood:selected?.neighborhood??''};
  }
 }
 if(!selected)return null;
 const field=selected.level==='country'?'country':selected.level==='state'?'state':selected.level==='zipcode'?'postal_code':'city';
 const value=field==='postal_code'?selected.zipcode:selected[field];
 const rows=await options.lookup(field,value);
 const places=rows.map(p=>({country:country(p.country),state:state(p.state,p.country),city:text(p.city),zipcode:zip(text(p.postal_code)),neighborhood:selected.neighborhood})).filter(p=>(!selected.country||same(selected.country,p.country))&&(!selected.state||same(selected.state,p.state))&&(field!=='city'||same(selected.city,p.city))&&(field!=='postal_code'||same(selected.zipcode,p.zipcode)));
 const unique=new Map(places.map(p=>[JSON.stringify([p.country,selected.level==='country'?'':p.state,['country','state','zipcode'].includes(selected.level)?'':p.city,selected.zipcode]),p]));
 if(unique.size!==1)return null;
 const place=[...unique.values()][0];if(!place.country)return null;
 return {country:place.country,state:selected.level==='country'?'':place.state,city:['country','state'].includes(selected.level)?'':selected.level==='zipcode'&&new Set(places.map(p=>p.city)).size>1?'':place.city,zipcode:selected.zipcode,neighborhood:selected.neighborhood};
}
