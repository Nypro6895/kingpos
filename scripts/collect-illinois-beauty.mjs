import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseLookup, parseStructured } from './collect-wisconsin-beauty.mjs';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');

const collectedOn = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
await mkdir('work/il-expansion', { recursive: true });
const fetchPage = async url => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw Error(`HTTP ${r.status}`); return await r.text(); }
    catch (e) { if (attempt === 2) throw Error(`${url}: ${e.message}`); }
  }
};
// Use the same contact validation while requiring Illinois explicitly.
const parse = (html, url, category, structured) => {
  return (structured ? parseStructured : parseLookup)(html, url, category, {code:'IL',name:'Illinois'}).map(b => ({
    ...b, id: `il-beauty-${createHash('sha256').update(`${b.phone}|${b.city.toLowerCase()}|${b.address.toLowerCase().replace(/[^a-z0-9]/g, '')}`).digest('hex').slice(0, 16)}`,
    state: 'IL', collectedOn,
  }));
};
const jobs = [];
for (const [host, category] of [['nailsalondirectories.com', 'Nails'], ['hairsalondirectories.com', 'Hair'], ['tattooshopdirectories.com', 'Tattoo']]) {
  const html = await fetchPage(`https://${host}/illinois`);
  console.log(`Discovered ${category} cities`);
  for (const p of new Set([...html.matchAll(/href="(\/illinois\/[a-z0-9-]+)"/g)].map(m => m[1]))) jobs.push({ url: `https://${host}${p}`, category, structured: true });
}
for (const [slug, category] of (process.argv.includes('--directory-only') ? [] : [['nail-salon','Nails'], ['hair-salon','Hair'], ['massage-therapist','Massage'], ['eyelash-salon','Lashes'], ['barber-shop','Hair'], ['day-spa','Spa'], ['spa','Spa'], ['eyebrow-bar','Brows'], ['waxing-hair-removal-service','Waxing'], ['esthetics-service','Skin Care'], ['facial-spa','Skin Care']])) {
  const url = `https://salonlookup.com/services/${slug}/il`;
  const html = await fetchPage(url);
  console.log(`Discovered ${category}: ${slug}`);
  const total = Number(html.match(/Page 1 of (\d+)/)?.[1] ?? 1);
  for (let page = 1; page <= total; page++) jobs.push({ url: `${url}?page=${page}`, category, structured: false });
}
const records = new Map(), failures = []; let position = 0, completed = 0;
async function worker() {
  while (position < jobs.length) {
    const job = jobs[position++];
    try {
      const entries = parse(await fetchPage(job.url), job.url, job.category, job.structured);
      for (const b of entries) {
        const previous = records.get(b.id);
        if (previous) { previous.categories = [...new Set([...previous.categories, ...b.categories])]; previous.additionalSources.push({ url: b.sourceUrl, category: job.category }); if (!previous.websiteUrl && b.websiteUrl) previous.websiteUrl = b.websiteUrl; }
        else records.set(b.id, { ...b, additionalSources: [{ url: b.sourceUrl, category: job.category }] });
      }
      if (++completed % 20 === 0) console.log(`${completed}/${jobs.length} pages; ${records.size} unique contacts`);
    } catch (e) { failures.push({ url: job.url, reason: e.message }); }
  }
}
await Promise.all([worker(), worker()]);
if (failures.length) throw Error(`Collection incomplete: ${JSON.stringify(failures)}`);
const payload = { collectedOn, coverage: 'Partial Illinois public beauty directories; complete name, street address, city and phone required. Categories are directory-reported, not owner-confirmed.', sourcePages: jobs.length, businesses: [...records.values()].sort((a,b) => a.id.localeCompare(b.id)) };
await writeFile('data/illinois-directory-sources.json', JSON.stringify(payload, null, 2) + '\n');
console.log(JSON.stringify({ records: records.size, categories: Object.fromEntries(['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care'].map(c => [c,payload.businesses.filter(b=>b.categories.includes(c)).length])) }));
