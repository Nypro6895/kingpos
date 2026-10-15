import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolveBusinessCoverImage } from '../lib/default-nail-images.ts';

// Offline preparation only: this script has no database or deployment client.
const input=JSON.parse(await readFile('data/florida-profile-sources.json','utf8'));
const categories=['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care'];
const profiles=input.businesses.map(b=>({
  ...b, claimState:'unclaimed', bookingEnabled:false, hoursConfirmed:false,
  defaultCoverImage:resolveBusinessCoverImage({id:b.id,name:b.name,categories:b.categories}),
  imageCredit:'AI illustration',
  referencePost:{title:`Discover ${b.name} in ${b.city}`,body:`${b.name} is listed under ${b.categories.map(c=>c.toLowerCase()).join(' and ')} in ${b.city}, Florida. The source lists ${b.address}, ${b.city}, FL ${b.postalCode} and contact number ${b.phone}. Contact the business directly to confirm services, prices and availability. This introduction was compiled by Reylumi from the linked third-party directory; it is reference information and has not been submitted or confirmed by the owner. Source: ${b.sourceUrl}`,status:'prepared_not_published'},
}));
if(!profiles.length||new Set(profiles.map(b=>b.id)).size!==profiles.length)throw Error('Empty or duplicate dataset');
for(const b of profiles){
  if(b.state!=='FL'||!b.name||!b.city||!b.sourceUrl||!/^\d{3}-\d{3}-\d{4}$/.test(b.phone)||!b.defaultCoverImage)throw Error(`Invalid profile ${b.id}`);
  await access(`public${b.defaultCoverImage}`);
}
await mkdir('work/florida-expansion',{recursive:true});
const counts=Object.fromEntries(categories.map(c=>[c,profiles.filter(b=>b.categories.includes(c)).length]));
const summary={state:'FL',collectedOn:input.collectedOn,profiles:profiles.length,sourcePages:input.sourcePages,categories:counts,emailsAvailable:profiles.filter(b=>b.email).length,status:'prepared_only_not_imported_or_deployed',coverage:input.coverage};
await writeFile('data/florida-prepared-profiles.json',JSON.stringify({...input,status:summary.status,businesses:profiles},null,2)+'\n');
await writeFile('work/florida-expansion/summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
