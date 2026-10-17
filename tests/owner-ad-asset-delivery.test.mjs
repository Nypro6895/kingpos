import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const built = await build({ entryPoints: ["app/api/campaigns/delivery/route.ts"], bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "delivery-deps", setup(b) {
    b.onResolve({ filter: /^(next\/headers|@\/lib\/(explore-advertising|current-context|owner-campaign-delivery|owner-campaigns|salon-profile))$/ }, a => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents:
      a.path === "next/headers" ? "export async function cookies(){return {get:()=>({value:'20000000-0000-0000-0000-000000000001'}),set(){}}}" :
      a.path.endsWith("current-context") ? "export async function getCurrentBusinessContext(){return {user:null}}" :
      a.path.endsWith("owner-campaigns") ? "export async function ownerCampaignSettings(){return {enabled:true}}" :
      a.path.endsWith("salon-profile") ? "export const getSalonProfileMediaUrl=()=>null" :
      a.path.endsWith("owner-campaign-delivery") ? "export const campaignVisitorHash=()=> 'visitor';export const campaignVisitorIdentity=()=> 'visitor';export const signCampaignTicket=()=> 'signed';export const readCampaignTicket=()=>null;" :
      `export const advertisingClient=()=>({
        from:()=>({select(){return this},eq(){return this},ilike(){return this},limit:async()=>({data:[{city:'Chicago',state:'Illinois',country:'United States'}],error:null})}),
        rpc:async name=> name==='owner_campaign_candidates'?{data:[{id:'campaign',salon_id:'salon',source_type:'custom',source_id:'creative',title:'Offer'}]}:{data:{media_path:globalThis.assetPath,caption:'Welcome'}},
        storage:{from:()=>({createSignedUrl:async path=>{globalThis.signedAssetPath=path;return globalThis.assetMissing?{data:null,error:{message:'missing'}}:{data:{signedUrl:'https://example.test/signed.webp'}}}})}
      });`, loader: "js" }));
  } }] });
const { GET } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
test("customer delivery fails closed when a required private image cannot be signed", async () => {
  globalThis.assetPath = "salon/owner/creative/v1/main.webp"; globalThis.assetMissing = true;
  assert.equal(await (await GET(new Request("https://example.test/api/campaigns/delivery?location=Chicago"))).json(), null);
});
test("new customer creatives deliver the prepared 960px asset; legacy paths still work", async () => {
  globalThis.assetMissing = false;
  globalThis.assetPath = "salon/owner/creative/v1/main.webp";
  const result = await (await GET(new Request("https://example.test/api/campaigns/delivery?location=Chicago"))).json();
  assert.equal(result.image, "https://example.test/signed.webp"); assert.equal(globalThis.signedAssetPath, "salon/owner/creative/v1/w960.webp");
  globalThis.assetPath = "salon/owner/old.webp";
  await GET(new Request("https://example.test/api/campaigns/delivery?location=Chicago"));
  assert.equal(globalThis.signedAssetPath, globalThis.assetPath);
});
