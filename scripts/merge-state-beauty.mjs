import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const code=process.argv[process.argv.indexOf('--state')+1];
const name={OR:'Oregon',WA:'Washington',FL:'Florida',CA:'California',TX:'Texas',GA:'Georgia',VA:'Virginia',MA:'Massachusetts',NC:'North Carolina',NY:'New York',NJ:'New Jersey',PA:'Pennsylvania'}[code];if(!name)throw Error('Unsupported state');
const slug=name.toLowerCase().replaceAll(' ','-');
const workDir=['OR','WA'].includes(code)?'work/pnw-expansion':`work/${slug}-expansion`;
await mkdir(workDir,{recursive:true});
const source=JSON.parse(await readFile(`data/${slug}-directory-sources.json`,'utf8'));
const canonical=value=>value.toLowerCase().replace(/[\s,]+(?:#|suite\b|ste\b|unit\b|space\b|studio\b|floor\b|room\b).*$/,'').replace(/\bstreet\b/g,'st').replace(/\bavenue\b/g,'ave').replace(/\broad\b/g,'rd').replace(/\bdrive\b/g,'dr').replace(/\bboulevard\b/g,'blvd').replace(/\bhighway\b/g,'hwy').replace(/[^a-z0-9]/g,'');
const contacts=new Map();
const excluded=[];
for(const item of source.businesses){
 const b={...item,name:item.name.trim(),address:item.address.trim(),city:item.city.trim()};
 if(b.state!==code||!b.name||!b.city||!/^\d{3}-\d{3}-\d{4}$/.test(b.phone)||! /^[2-9]\d{2}-[2-9]\d{2}-\d{4}$/.test(b.phone)||/^\d{3}-555-01\d{2}$/.test(b.phone)){excluded.push({id:b.id,name:b.name,address:b.address,sourceUrl:b.sourceUrl,reason:'Invalid state or incomplete/invalid public contact'});continue;}
 if(!/\b\d+[a-z]?(?:-\d+)?\s+\S+/i.test(b.address)){excluded.push({id:b.id,name:b.name,address:b.address,sourceUrl:b.sourceUrl,reason:'No usable numbered street address'});continue;}
 const key=`${b.phone}|${b.city.toLowerCase()}|${canonical(b.address)}`;
 const prior=contacts.get(key);
 if(prior){prior.categories=[...new Set([...prior.categories,...b.categories])];prior.additionalSources=[...prior.additionalSources,...b.additionalSources];if(!prior.websiteUrl&&b.websiteUrl)prior.websiteUrl=b.websiteUrl;if(b.address.length>prior.address.length)prior.address=b.address;}
 else contacts.set(key,{...b,id:`${code.toLowerCase()}-beauty-${createHash('sha256').update(key).digest('hex').slice(0,16)}`});
}
const payload={...source,businesses:[...contacts.values()].sort((a,b)=>a.id.localeCompare(b.id))};
await writeFile(`data/${slug}-profile-sources.json`,JSON.stringify(payload,null,2)+'\n');
await writeFile(`${workDir}/${slug}-excluded.json`,JSON.stringify(excluded,null,2)+'\n');
console.log(JSON.stringify({state:code,raw:source.businesses.length,profiles:contacts.size,excluded:excluded.length,categories:Object.fromEntries(['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care'].map(c=>[c,payload.businesses.filter(b=>b.categories.includes(c)).length]))}));
