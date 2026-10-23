import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolveBusinessCoverImage } from '../lib/default-nail-images.ts';

// Prepare reviewable profiles offline; deliberately contains no database client.
const states = { CA:'California', TX:'Texas', GA:'Georgia', VA:'Virginia', MA:'Massachusetts', NC:'North Carolina', NY:'New York', NJ:'New Jersey', PA:'Pennsylvania' };
const code = process.argv[process.argv.indexOf('--state') + 1];
const name = states[code];
if (!name) throw Error('Unsupported expansion state');
const slug = name.toLowerCase().replaceAll(' ', '-');
const input = JSON.parse(await readFile(`data/${slug}-profile-sources.json`, 'utf8'));
const categories = ['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care'];
const status = 'prepared_only_not_imported_or_deployed';
const businesses = input.businesses.map(b => ({
  ...b, email: b.email ?? '', claimState: 'unclaimed', bookingEnabled: false, hoursConfirmed: false,
  defaultCoverImage: resolveBusinessCoverImage({ id:b.id, name:b.name, categories:b.categories }),
  imageCredit: 'AI illustration',
  referencePost: {
    title: `Discover ${b.name} in ${b.city}`,
    body: `${b.name} is listed under ${b.categories.map(c=>c.toLowerCase()).join(' and ')} in ${b.city}, ${name}. The source lists ${b.address}, ${b.city}, ${code}${b.postalCode ? ` ${b.postalCode}` : ''} and contact number ${b.phone}. Contact the business directly to confirm services, prices and availability. This introduction was compiled by Reylumi from the linked ${b.sourceType==='business_website'?'official business website':'third-party directory'}; it is reference information and has not been submitted or confirmed by the owner. Source: ${b.sourceUrl}`,
    status: 'prepared_not_published',
  },
}));
if (!businesses.length || new Set(businesses.map(b=>b.id)).size !== businesses.length) throw Error('Empty or duplicate dataset');
const images = new Set();
for (const b of businesses) {
  if (b.state !== code || !b.name || !b.city || !b.address || !/^https:\/\//.test(b.sourceUrl) || !/^[2-9]\d{2}-[2-9]\d{2}-\d{4}$/.test(b.phone) || !b.defaultCoverImage) throw Error(`Invalid profile ${b.id}`);
  if (!b.categories.length || b.categories.some(c=>!categories.includes(c))) throw Error(`Invalid categories ${b.id}`);
  images.add(b.defaultCoverImage);
}
for (const image of images) await access(`public${image}`);
const summary = {state:code,name,collectedOn:input.collectedOn,profiles:businesses.length,sourcePages:input.sourcePages,categories:Object.fromEntries(categories.map(c=>[c,businesses.filter(b=>b.categories.includes(c)).length])),emailsAvailable:businesses.filter(b=>b.email).length,defaultImagesUsed:images.size,status,coverage:input.coverage,categoriesMissing:categories.filter(c=>!input.categoriesCollected?.includes(c)),pendingImportChecks:['Verify operating timezone per record, including Texas time-zone boundary','Compare existing listings and claimed owners; apply suppression ledger','Rollback batch and bounded atomic source/projection import under docs/explore-read-model.md','Verify anonymous Explore pagination, profile contact and claim links']};
await mkdir(`work/${slug}-expansion`,{recursive:true});
await writeFile(`data/${slug}-prepared-profiles.json`,JSON.stringify({...input,status,businesses},null,2)+'\n');
await writeFile(`work/${slug}-expansion/summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
