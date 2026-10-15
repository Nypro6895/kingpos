import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decode } from './collect-wisconsin-beauty.mjs';
const collectedOn = new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'});
async function page(url) { for(let n=0;n<3;n++){try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`HTTP ${r.status}`);return await r.text();}catch(e){if(n===2)throw Error(`${url}: ${e.message}`)}} }
const links = (html,pattern) => [...new Set([...html.matchAll(/(?:href|data-link)="([^"]+)"/g)].map(m=>m[1]).filter(s=>pattern.test(s)))];
const jobs=[];
for(const chain of ['envy','wax']) {
 const root=chain==='envy'?'https://locations.massageenvy.com/illinois.html':'https://locations.waxcenter.com/il/';
 const cities=links(await page(root),chain==='envy'?/^https:\/\/locations\.massageenvy\.com\/illinois\/[^/]+\.html$/:/^https:\/\/locations\.waxcenter\.com\/il\/[^/]+\/$/);
 for(const city of cities){const html=await page(city);for(const url of links(html,chain==='envy'?/^(?:https:\/\/locations\.massageenvy\.com)?\/illinois\/[^/]+\/[^/]+\.html$/:/^https:\/\/locations\.waxcenter\.com\/il\/[^/]+\/[^/?]+\.html$/))jobs.push({url:new URL(url,city).href,chain});}
 console.log(chain, cities.length,'cities');
}
const records=[];let position=0;
async function worker(){while(position<jobs.length){const job=jobs[position++];const html=await page(job.url);for(const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)){
 let data;try{data=JSON.parse(m[1]);}catch{continue;}
 for(const b of (Array.isArray(data)?data:[data])){const a=b.address;if(!a||a.addressRegion!=='IL')continue;const n=String(b.telephone??a.telephone??'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');if(n.length!==10||!b.name||!a.streetAddress||!a.addressLocality)continue;
 const phone=`${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`;const address=decode(a.streetAddress).trim(),city=decode(a.addressLocality).trim();
 const categories=job.chain==='wax'?['Waxing','Brows']:['Massage',...(/<h[1-6][^>]*>[^<]*(?:Facials|Skin Care)/i.test(html)?['Skin Care']:[])];
 records.push({id:`il-beauty-${createHash('sha256').update(`${phone}|${city.toLowerCase()}|${address.toLowerCase().replace(/[^a-z0-9]/g,'')}`).digest('hex').slice(0,16)}`,name:decode(b.name),address,city,postalCode:a.postalCode??'',state:'IL',phone,email:'',categories,sourceUrl:job.url,sourceType:'business_website',websiteUrl:job.url,collectedOn,notes:'Public contact information from the official location website; not owner-confirmed in Reylumi.',additionalSources:[{url:job.url,category:categories.join(', ')}]});
 }
 }}}
await Promise.all([worker(),worker()]);
await writeFile('data/illinois-chain-sources.json',JSON.stringify({collectedOn,businesses:records},null,2)+'\n');console.log('Official chain locations:',records.length);
