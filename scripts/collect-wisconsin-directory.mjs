import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const origin = "https://nailsalondirectories.com";
function decode(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
export function parseCityPage(html, sourceUrl) {
  const results = [];
  for (const match of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)) {
    const article = match[1];
    const script = article.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!script) continue;
    let item;
    try { item = JSON.parse(script[1]); } catch { continue; }
    if (item["@type"] !== "NailSalon") continue;
    const address = item.address;
    if (!address || !["Wisconsin", "WI"].includes(address.addressRegion)) continue;
    const digits = String(item.telephone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (digits.length !== 10 || !item.name || !address.streetAddress || !address.addressLocality) continue;
    const plain = decode(article.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
    const zip = plain.match(/\bWI\s+(\d{5})(?:-\d{4})?\b/)?.[1] ?? "";
    const key = `${digits}|${address.streetAddress.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    let websiteUrl = "";
    try { const url = new URL(item.url); if (["https:", "http:"].includes(url.protocol)) websiteUrl = url.href; } catch {}
    results.push({
      id: `wi-directory-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`,
      name: decode(item.name), categories: ["Nails"], address: decode(address.streetAddress),
      city: decode(address.addressLocality), postalCode: zip,
      phone: `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`, email: "",
      sourceUrl, sourceType: "directory", websiteUrl,
      notes: "Nails category and contact details are reported by a third-party directory and have not been confirmed with the business.",
    });
  }
  return results;
}

async function fetchHtml(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { "User-Agent": "ReylumiPublicDirectory/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const index = await fetchHtml(`${origin}/wisconsin`);
  const paths = [...new Set([...index.matchAll(/href="(\/wisconsin\/[a-z0-9-]+)"/g)].map((match) => match[1]))];
  if (!paths.length) throw new Error("No city links found; refusing to replace existing data.");
  const official = JSON.parse(await readFile(new URL("../data/wisconsin-business-sources.json", import.meta.url), "utf8"));
  const existingPhones = new Set(official.businesses.map((item) => item.phone.replace(/\D/g, "")));
  const records = new Map();
  const failures = [];
  let position = 0;
  async function worker() {
    while (position < paths.length) {
      const path = paths[position++];
      const url = origin + path;
      try {
        const html = await fetchHtml(url);
        const entries = parseCityPage(html, url);
        if (!html.includes('"@type":"NailSalon"')) throw new Error("Listing markup missing");
        for (const entry of entries) {
          if (!existingPhones.has(entry.phone.replace(/\D/g, ""))) records.set(entry.id, entry);
        }
        console.log(`${path}: ${entries.length} contact records`);
      } catch (error) { failures.push({ url, reason: error.message }); }
    }
  }
  await Promise.all([worker(), worker()]);
  if (failures.length) {
    throw new Error(`Collection incomplete; previous dataset preserved. Failed pages: ${JSON.stringify(failures)}`);
  }
  const collectedOn = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const payload = { collectedOn, coverage: "Public Wisconsin city pages from NailSalonDirectories.com; not complete statewide coverage or owner verification", cityPages: paths.length, businesses: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(new URL("../data/wisconsin-directory-sources.json", import.meta.url), JSON.stringify(payload, null, 2) + "\n");
  console.log(JSON.stringify({ additionalRecords: records.size, cityPages: paths.length, failures }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`))) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
