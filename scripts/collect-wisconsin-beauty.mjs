import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const decode = value => value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(?:39|x27);|&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const phone = value => { const n = String(value??'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,''); return n.length===10 ? `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}` : ''; };
const makeRecord = (name,address,city,postalCode,number,category,sourceUrl,websiteUrl='') => ({id:`wi-beauty-${createHash('sha256').update(`${phone(number)}|${address.toLowerCase().replace(/[^a-z0-9]/g,'')}`).digest('hex').slice(0,16)}`,name:decode(name),address:decode(address),city:decode(city),postalCode,phone:phone(number),email:'',categories:[category],sourceUrl,sourceType:'directory',websiteUrl,notes:`Contact details and ${category} category reported by a public directory; not owner confirmed.`});
export function parseStructured(html,url,category,region={code:'WI',name:'Wisconsin'}) {
  const records=[];
  for(const match of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)) {
    const raw=match[1].match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if(!raw)continue;
    let item;try{item=JSON.parse(raw);}catch{continue;}
    const a=item.address;
    if(!a||![region.name,region.code].includes(a.addressRegion)||!item.name||!a.streetAddress||!a.addressLocality||!phone(item.telephone))continue;
    const zip=decode(match[1].replace(/<[^>]*>/g,' ')).match(new RegExp(`\\b${region.code}\\s+(\\d{5})\\b`))?.[1]??'';
    records.push(makeRecord(item.name,a.streetAddress,a.addressLocality,a.postalCode??zip,item.telephone,category,url,/^https?:\/\//.test(item.url??'')?item.url:''));
  }
  return records;
}
export function parseLookup(html,url,category,region={code:'WI',name:'Wisconsin'}) {
  const records=[];
  for(const m of html.matchAll(/<div class="business-card"><div><h3><a href="([^"]+)">([\s\S]*?)<\/a><\/h3><div class="meta">([\s\S]*?)<\/div>/g)) {
    const name=decode(m[2].replace(/<[^>]*>/g,''));
    const text=decode(m[3].replace(/<[^>]*>/g,''));
    const number=text.match(/·\s*(.+)$/)?.[1];
    const address=text.replace(`${name}, `,'').match(new RegExp(`^(.+),\\s*([^,]+),\\s*${region.code}\\s+(\\d{5})\\s*·`));
    if(!address||!phone(number))continue;
    records.push(makeRecord(name,address[1],address[2],address[3],number,category,new URL(m[1],url).href));
  }
  return records;
}
async function fetchPage(url) {
  let last;
  for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`HTTP ${r.status}`);return await r.text();}catch(e){last=e;}}
  throw last;
}
async function main() {
  await mkdir('work/wi-expansion',{recursive:true});
  const jobs=[];
  for(const [host,category]of [['hairsalondirectories.com','Hair'],['tattooshopdirectories.com','Tattoo']]) {
    const html=await fetchPage(`https://${host}/wisconsin`);
    for(const path of new Set([...html.matchAll(/href="(\/wisconsin\/[a-z0-9-]+)"/g)].map(m=>m[1])))jobs.push({url:`https://${host}${path}`,category,parser:parseStructured});
  }
  for(const [slug,category]of [['massage-therapist','Massage'],['eyelash-salon','Lashes']]) {
    const url=`https://salonlookup.com/services/${slug}/wi`;
    const html=await fetchPage(url);
    const total=Number(html.match(/Page 1 of (\d+)/)?.[1]??Math.max(1,...[...html.matchAll(/\?page=(\d+)/g)].map(m=>Number(m[1]))));
    for(let page=1;page<=total;page++)jobs.push({url:`${url}?page=${page}`,category,parser:parseLookup});
  }
  const records=new Map(), failures=[];let position=0;
  const worker=async()=>{while(position<jobs.length){const job=jobs[position++];try{const html=await fetchPage(job.url);const entries=job.parser(html,job.url,job.category);for(const b of entries){const previous=records.get(b.id);if(previous){previous.categories=[...new Set([...previous.categories,...b.categories])];previous.additionalSources.push({url:b.sourceUrl,category:job.category});}else records.set(b.id,{...b,additionalSources:[{url:b.sourceUrl,category:job.category}]});}console.log(`${position}/${jobs.length} ${job.category}: ${entries.length}`);}catch(e){failures.push({url:job.url,reason:e.message});}}};
  await Promise.all([worker(),worker()]);
  if(failures.length)throw Error(`Incomplete collection; previous data preserved: ${JSON.stringify(failures)}`);
  const payload={collectedOn:new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'}),coverage:'Public Wisconsin hair and tattoo city directories, plus statewide massage and eyelash directory pages. Partial coverage; only complete name/address/phone contacts retained.',sourcePages:jobs.length,businesses:[...records.values()].sort((a,b)=>a.id.localeCompare(b.id))};
  await writeFile('data/wisconsin-beauty-sources.json',JSON.stringify(payload,null,2)+'\n');
  console.log(JSON.stringify({records:records.size,categories:Object.fromEntries(['Hair','Massage','Tattoo','Lashes'].map(c=>[c,payload.businesses.filter(b=>b.categories.includes(c)).length]))}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url).toLowerCase()===process.argv[1].toLowerCase())main().catch(e=>{console.error(e);process.exitCode=1;});
