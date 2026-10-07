import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parseCityPage } from "../scripts/collect-wisconsin-directory.mjs";

const official = JSON.parse(readFileSync(new URL("../data/wisconsin-business-sources.json", import.meta.url)));
const directory = JSON.parse(readFileSync(new URL("../data/wisconsin-directory-sources.json", import.meta.url)));
const source = readFileSync(new URL("../lib/wisconsin-directory.ts", import.meta.url), "utf8")
  .replace(/^import sourceData.*$/m, `const sourceData = ${JSON.stringify(official)};`)
  .replace(/^import directoryData.*$/m, `const directoryData = ${JSON.stringify(directory)};`);
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { wisconsinBusinesses, searchWisconsinBusinesses } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("every published listing has traceable contact details and a platform reference post", () => {
  const ids = new Set();
  for (const business of wisconsinBusinesses) {
    assert.ok(!ids.has(business.id), business.id); ids.add(business.id);
    assert.ok(business.name && business.address && business.city);
    assert.match(business.phone, /^\d{3}-\d{3}-\d{4}$/);
    assert.equal(business.state, "WI");
    assert.equal(business.verificationStatus, "unclaimed");
    assert.equal(business.linkedSalonId, null);
    assert.ok(new URL(business.sourceUrl).protocol === "https:");
    assert.ok(business.email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business.email));
    assert.equal(business.image, null);
    assert.equal(business.post.kind, "reference");
    assert.equal(business.post.author, "Reylumi directory");
    assert.ok(business.post.body.includes(business.phone));
    assert.ok(business.post.body.includes("not been submitted or confirmed by the owner"));
  }
  assert.equal(ids.size, official.businesses.length + directory.businesses.length);
});

test("search combines city/category filters and supports a formatted phone", () => {
  assert.equal(searchWisconsinBusinesses("(608) 720-1011")[0].name, "Madison Nail Lounge");
  assert.ok(searchWisconsinBusinesses("", "Nails", "Madison").every((item) => item.city === "Madison" && item.categories.includes("Nails")));
  assert.equal(searchWisconsinBusinesses("nonexistent-name-9999999999").length, 0);
  assert.ok(searchWisconsinBusinesses("nails Madison").length > 0);
  assert.ok(searchWisconsinBusinesses("", "Massage").some((item) => item.categories.includes("Hair")));
});

test("collector rejects missing phone/out-of-state records and strips copied reviews", () => {
  const item = { "@type": "NailSalon", name: "Test & Nails", telephone: "+1 (608) 555-0123", url: "javascript:alert(1)", address: { streetAddress: "10 Main St", addressLocality: "Madison", addressRegion: "WI" }, aggregateRating: { ratingValue: 5 } };
  const card = (data) => `<article><p>Madison, WI 53703</p><script type="application/ld+json">${JSON.stringify(data)}</script></article>`;
  const results = parseCityPage(card(item) + card({ ...item, telephone: "" }) + card({ ...item, address: { ...item.address, addressRegion: "IL" } }), "https://nailsalondirectories.com/wisconsin/madison");
  assert.equal(results.length, 1);
  assert.equal(results[0].phone, "608-555-0123");
  assert.equal(results[0].postalCode, "53703");
  assert.equal(results[0].email, "");
  assert.equal(results[0].websiteUrl, "");
  assert.equal(results[0].aggregateRating, undefined);
  assert.equal(results[0].sourceType, "directory");
});
