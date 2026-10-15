import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({entryPoints:["lib/owner-campaign-rules.ts"],bundle:true,write:false,format:"esm",platform:"node",alias:{"@":process.cwd()}});
const {normalizeOwnerCampaignSettings,campaignQuote,validateCampaignLocation} = await import("data:text/javascript;base64,"+Buffer.from(bundle.outputFiles[0].text).toString("base64"));
test("quotes stay in integer cents and apply both daily and duration limits",()=>{
  const settings=normalizeOwnerCampaignSettings();
  assert.deepEqual(campaignQuote(settings,500,7),{dailyCents:100,totalCents:700});
  assert.deepEqual(campaignQuote(settings,501,7),{dailyCents:101,totalCents:707});
  assert.deepEqual(campaignQuote(settings,100,3),{dailyCents:100,totalCents:300});
  for(const views of [99,10001,NaN,Infinity,500.5]) assert.throws(()=>campaignQuote(settings,views,7));
  for(const days of [0,31,NaN,2.5]) assert.throws(()=>campaignQuote(settings,500,days));
});
test("invalid admin settings cannot become permissive delivery values",()=>{
  const settings=normalizeOwnerCampaignSettings({enabled:false, dailyFrequency:99, dailyPriceCents:0,maxDays:-1,maxAdsPerDay:0});
  assert.equal(settings.enabled,false);assert.equal(settings.dailyFrequency,2);assert.equal(settings.dailyPriceCents,100);assert.equal(settings.maxDays,30);assert.equal(settings.maxAdsPerDay,6);
});
test("small-area targeting requires enough detail to distinguish places",()=>{
  assert.throws(()=>validateCampaignLocation("neighborhood","Lincoln Park","United States","Illinois",""));
  assert.throws(()=>validateCampaignLocation("city","Springfield","United States","",""));
  assert.throws(()=>validateCampaignLocation("city","","United States","Illinois",""));
  assert.doesNotThrow(()=>validateCampaignLocation("neighborhood","Lincoln Park","United States","Illinois","Chicago"));
});

test("welcome credit covers three local days and scope changes the quote",()=>{const s=normalizeOwnerCampaignSettings();assert.equal(s.welcomeCredits,300);for(const [area,total]of [["neighborhood",240],["zipcode",240],["city",300],["state",450],["country",600]])assert.equal(campaignQuote(s,500,3,area).totalCents,total);});
