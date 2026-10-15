import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({entryPoints:["lib/owner-campaign-delivery.ts"],bundle:true,write:false,format:"esm",platform:"node",plugins:[{name:"server-only",setup(builder){builder.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"stub"}));builder.onLoad({filter:/.*/,namespace:"stub"},()=>({contents:"",loader:"js"}));}}]});
const {signCampaignTicket,readCampaignTicket,campaignVisitorHash,campaignVisitorIdentity} = await import("data:text/javascript;base64,"+Buffer.from(bundle.outputFiles[0].text).toString("base64"));
test("signed delivery tickets reject tampering, expiry and extra signature data",()=>{
  const previous=process.env.ADVERTISING_IP_HASH_SECRET;
  process.env.ADVERTISING_IP_HASH_SECRET="owner-campaign-test-secret";
  try{
    const ticket={id:"campaign",visitor:"a".repeat(64),viewer:null,area:{city:"Chicago"},expires:Date.now()+10000,nonce:"unique"};
    const signed=signCampaignTicket(ticket);assert.deepEqual(readCampaignTicket(signed),ticket);
    const [,signature]=signed.split(".");const tampered=Buffer.from(JSON.stringify({...ticket,area:{city:"Milwaukee"}})).toString("base64url");
    assert.equal(readCampaignTicket(`${tampered}.${signature}`),null);
    assert.equal(readCampaignTicket(signed+".extra"),null);
    assert.equal(readCampaignTicket(signCampaignTicket({...ticket,expires:Date.now()-1})),null);
    assert.equal(campaignVisitorHash("same visitor"),campaignVisitorHash("same visitor"));
    assert.notEqual(campaignVisitorHash("visitor a"),campaignVisitorHash("visitor b"));
    assert.equal(campaignVisitorIdentity(new Headers(),"browser a","owner"),campaignVisitorIdentity(new Headers(),"browser b","owner"));
  }finally{if(previous===undefined)delete process.env.ADVERTISING_IP_HASH_SECRET;else process.env.ADVERTISING_IP_HASH_SECRET=previous;}
});
