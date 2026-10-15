import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decode } from './collect-wisconsin-beauty.mjs';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const states={CA:'California',TX:'Texas',GA:'Georgia',VA:'Virginia',MA:'Massachusetts',NC:'North Carolina',NY:'New York',NJ:'New Jersey',PA:'Pennsylvania'};
const code=process.argv[process.argv.indexOf('--state')+1],name=states[code];
if(!name)throw Error('Unsupported expansion state');
const slug=name.toLowerCase().replaceAll(' ','-'),short=code.toLowerCase();
const collectedOn=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'});
const workDir=`work/${slug}-expansion`,cacheDir=`${workDir}/official-page-cache/${collectedOn}`;
await mkdir(cacheDir,{recursive:true});
async function page(url){
 const path=`${cacheDir}/${createHash('sha256').update(url).digest('hex')}.html`;
 try{return await readFile(path,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`HTTP ${r.status}`);const html=await r.text();await writeFile(path,html);return html;}catch(e){if(attempt===2)throw Error(`${url}: ${e.message}`);}}
}
const links=(html,base,pattern)=>[...new Set([...html.matchAll(/(?:href|data-link)="([^"]+)"/g)].map(m=>{try{return new URL(decode(m[1]),base).href;}catch{return '';}}).filter(s=>pattern.test(s)))];
const records=[],failures=[],seenPages=new Set();
for(const chain of ['envy','wax']){
 const host=chain==='envy'?'locations.massageenvy.com':'locations.waxcenter.com';
 const root=chain==='envy'?`https://${host}/${slug}.html`:`https://${host}/${short}/`;
 const cityPattern=chain==='envy'?new RegExp(`^https://locations\\.massageenvy\\.com/${slug}/[^/]+\\.html$`):new RegExp(`^https://locations\\.waxcenter\\.com/${short}/[^/]+/$`);
 const detailPattern=chain==='envy'?new RegExp(`^https://locations\\.massageenvy\\.com/${slug}/[^/]+/[^/]+\\.html$`):new RegExp(`^https://locations\\.waxcenter\\.com/${short}/[^/]+/[^/?]+\\.html$`);
 let cities;try{cities=links(await page(root),root,cityPattern);seenPages.add(root);if(!cities.length)throw Error('No cities found');}catch(e){failures.push({url:root,reason:e.message});continue;}
 const jobs=new Set();
 for(const city of cities){try{const html=await page(city);seenPages.add(city);for(const url of links(html,city,detailPattern))jobs.add(url);}catch(e){failures.push({url:city,reason:e.message});}}
 console.log(`${code} ${chain}: ${cities.length} cities, ${jobs.size} locations`);
 let position=0;const urls=[...jobs];
 async function worker(){while(position<urls.length){const url=urls[position++];try{
  const html=await page(url);seenPages.add(url);let found=false;
  for(const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)){
   let data;try{data=JSON.parse(m[1]);}catch{continue;}
   const entries=Array.isArray(data)?data:data['@graph']??[data];
   for(const b of entries){const a=b.address;if(!a||![code,name].includes(a.addressRegion))continue;
    const n=String(b.telephone??a.telephone??'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
    if(n.length!==10||!b.name||!a.streetAddress||!a.addressLocality)continue;
    const phone=`${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`,address=decode(a.streetAddress).trim(),city=decode(a.addressLocality).trim();
    const categories=chain==='wax'?['Waxing','Brows']:['Massage',...(/<h[1-6][^>]*>[^<]*(?:Facials|Skin Care)/i.test(html)?['Skin Care']:[])];
    records.push({id:`${short}-beauty-${createHash('sha256').update(`${phone}|${city.toLowerCase()}|${address.toLowerCase().replace(/[^a-z0-9]/g,'')}`).digest('hex').slice(0,16)}`,name:decode(b.name),address,city,postalCode:a.postalCode??'',state:code,phone,email:'',categories,sourceUrl:url,sourceType:'business_website',websiteUrl:url,collectedOn,notes:'Public business contact from the official location website; not owner-confirmed in Reylumi.',additionalSources:[{url,category:categories.join(', ')}]});found=true;
   }
  }
  if(!found)failures.push({url,reason:'No complete state-matching location contact in structured data'});
 }catch(e){failures.push({url,reason:e.message});}}}
 await Promise.all([worker(),worker()]);
}
await writeFile(`${workDir}/official-collection.json`,JSON.stringify({collectedOn,sourcePages:seenPages.size,businesses:records,failures},null,2)+'\n');
// A failed page is reported rather than silently claiming complete chain coverage.
const sourcePath=`data/${slug}-directory-sources.json`,input=JSON.parse(await readFile(sourcePath,'utf8'));
const official=new Map(records.map(b=>[b.id,b]));
const priorOfficial=new Map(input.businesses.filter(b=>/^https:\/\/locations\.(?:massageenvy|waxcenter)\.com\//.test(b.sourceUrl)).map(b=>[b.sourceUrl,b]));
for(const b of official.values()){
 const prior=priorOfficial.get(b.sourceUrl);
 if(prior&&(prior.phone!==b.phone||prior.address!==b.address||prior.city!==b.city)){failures.push({url:b.sourceUrl,reason:'Changed official contact identity requires review; previous record preserved'});continue;}
 priorOfficial.set(b.sourceUrl,b);
}
const combined=[...input.businesses.filter(b=>!/^https:\/\/locations\.(?:massageenvy|waxcenter)\.com\//.test(b.sourceUrl)),...priorOfficial.values()];
await writeFile(sourcePath,JSON.stringify({...input,collectionMode:'directories-and-official-chains',categoriesCollected:[...new Set(combined.flatMap(b=>b.categories))],sourcePages:input.sourcePages-(input.officialSourcePages??0)+seenPages.size,officialSourcePages:seenPages.size,officialFailures:failures,coverage:`Partial ${name} public nail, hair and tattoo directories plus official Massage Envy and European Wax Center locations. Complete name, street address, city and phone required; no claim of statewide completeness.`,businesses:combined},null,2)+'\n');
console.log(JSON.stringify({state:code,officialRecords:official.size,failedPages:failures.length}));
