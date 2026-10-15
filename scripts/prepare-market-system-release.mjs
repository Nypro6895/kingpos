import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const baseline=JSON.parse(await fs.readFile('work/market-system-baseline-hashes.json','utf8'));
const root=baseline.root;const paths=new Set(Object.keys(baseline.files));
async function walk(dir){for(const item of await fs.readdir(path.join(root,dir),{withFileTypes:true})){const rel=dir+'/'+item.name;if(item.isDirectory())await walk(rel);else paths.add(rel);}}
for(const dir of ['app','lib','supabase/migrations'])await walk(dir);
const source={};const overlays=[];
for(const file of [...paths].sort()){const bytes=await fs.readFile(path.join(root,file));source[file]=hash(bytes);if(source[file]!==baseline.files[file]){overlays.push({file,baseline:baseline.files[file]??null,sha256:source[file]});const target=path.join('work/market-system-overlay',file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);}}
const required=['app/api/explore/search/route.ts','app/api/explore/feed/route.ts','app/api/explore/area/route.ts','app/explore/explore-discovery-feed.tsx',...['search','search-rpc','search-client','feed-client','visitor','feed-discovery','social-feed','social-feed-ranking','query-intent','query-routing'].map(x=>`lib/explore-${x}.ts`),...Object.keys(source).filter(x=>x.startsWith('lib/location/'))];
for(const file of required)if(!source[file]||source[file]!==baseline.files[file])throw Error('Explore source changed or missing: '+file);
const aggregate=obj=>hash(Object.keys(obj).sort().map(file=>file+'\t'+obj[file]).join('\n'));
const receipt={baselineDeployment:baseline.deployment,releaseDirectory:root,baselineSourceSha256:aggregate(baseline.files),assembledSourceSha256:aggregate(source),overlaySha256:hash(JSON.stringify(overlays)),files:Object.keys(source).length,overlays,explorePreserved:required,preparedAt:new Date().toISOString(),validation:{localBuild:'pending final build',databaseTests:11,providerTests:'passed mocked API, no live credentials',responsive:'passed 1440,768,390; actual components with backend fixtures',eslint:'passed'},paymentConnection:'not connected; live purchases disabled'};
await fs.writeFile('work/market-system-assembled-hashes.json',JSON.stringify(source,null,2));await fs.writeFile('work/market-system-release-receipt.json',JSON.stringify(receipt,null,2));
console.log(JSON.stringify({files:receipt.files,overlays:overlays.map(x=>x.file),explorePreserved:required.length,assembledSourceSha256:receipt.assembledSourceSha256},null,2));
