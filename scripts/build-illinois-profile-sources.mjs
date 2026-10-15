import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const read=async file=>JSON.parse(await readFile(`data/${file}`,'utf8'));
const directory=await read('illinois-directory-sources.json');
const datasets=[directory,await read('illinois-chain-sources.json'),await read('illinois-official-contacts.json')];
const canonical=address=>address.toLowerCase().replace(/\bstreet\b/g,'st').replace(/\bavenue\b/g,'ave').replace(/\broad\b/g,'rd').replace(/\bdrive\b/g,'dr').replace(/\bsuite\b/g,'ste').replace(/[^a-z0-9]/g,'');
const contacts=new Map();
for(const dataset of datasets)for(const b of dataset.businesses){
 const key=`${b.phone}|${b.city.trim().toLowerCase()}|${canonical(b.address)}`;
 const record={...b,state:'IL',collectedOn:b.collectedOn??dataset.collectedOn,email:b.email??'',sourceType:b.sourceType??'business_website',websiteUrl:b.websiteUrl??(b.sourceType==='directory'?'':b.sourceUrl),id:b.id??`il-beauty-${createHash('sha256').update(key).digest('hex').slice(0,16)}`,additionalSources:b.additionalSources??[{url:b.sourceUrl,category:b.categories.join(', ')}]};
 const prior=contacts.get(key);
 if(prior){const categories=[...new Set([...prior.categories,...record.categories])],additionalSources=[...prior.additionalSources,...record.additionalSources];contacts.set(key,{...(record.sourceType==='business_website'?record:prior),id:prior.id,categories,additionalSources,email:record.email||prior.email});}
 else contacts.set(key,record);
}
const payload={collectedOn:directory.collectedOn,coverage:'Partial Illinois coverage: statewide nails, hair and tattoo city directories; official Massage Envy and European Wax Center Illinois locations; additional beauty studio websites. SalonLookup unavailable during collection. Contact details are not owner confirmed in Reylumi.',sourcePages:directory.sourcePages,businesses:[...contacts.values()].sort((a,b)=>a.id.localeCompare(b.id))};
await writeFile('data/illinois-profile-sources.json',JSON.stringify(payload,null,2)+'\n');
console.log(JSON.stringify({records:contacts.size,official:payload.businesses.filter(b=>b.sourceType==='business_website').length,categories:Object.fromEntries(['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care'].map(c=>[c,payload.businesses.filter(b=>b.categories.includes(c)).length]))}));
