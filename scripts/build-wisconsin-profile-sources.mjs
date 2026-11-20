import { readFile, writeFile } from 'node:fs/promises';
const records = new Map();
const contactKey = b => `${b.phone.replace(/\D/g,'')}|${b.address.toLowerCase().replace(/[^a-z0-9]/g,'')}`;
for (const name of ['wisconsin-business-sources.json','wisconsin-directory-sources.json','wisconsin-beauty-sources.json']) {
  const payload = JSON.parse(await readFile(`data/${name}`,'utf8'));
  for (const b of payload.businesses) {
    const key=contactKey(b), previous=records.get(key);
    if (previous) {
      previous.categories=[...new Set([...previous.categories,...b.categories])];
      previous.additionalSources=[...(previous.additionalSources??[]),...(b.additionalSources??[{url:b.sourceUrl,category:b.categories.join(', ')}])];
    } else records.set(key,{...b,collectedOn:payload.collectedOn});
  }
}
const businesses=[...records.values()];
await writeFile('data/wisconsin-profile-sources.json',JSON.stringify({collectedOn:new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'}),businesses},null,2)+'\n');
console.log(JSON.stringify({uniqueBusinesses:businesses.length,categories:Object.fromEntries(['Nails','Hair','Massage','Tattoo','Lashes'].map(c=>[c,businesses.filter(b=>b.categories.includes(c)).length]))}));
