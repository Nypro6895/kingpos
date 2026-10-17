import test from 'node:test';
import assert from 'node:assert/strict';
import { getSalonDiscoveryReadiness, getSalonProfileReadiness } from '../lib/salon-publication-readiness.ts';

const setting = {business_name:'Test salon',phone:'5550100',address_line1:'Test address',city:'Test city',state:'WI',postal_code:'53000',business_description:'Test description',public_profile_tagline:'Test tagline',public_profile_logo_path:'logo',public_profile_cover_path:'cover',public_discovery_enabled:false};
const profile = (patch={}) => getSalonProfileReadiness({setting:{...setting,...patch},looks:[{status:'published'}],services:[{is_active:true}],staff:[]});
const discovery = (patch={}) => getSalonDiscoveryReadiness({setting:{...setting,...patch},activeServiceCount:1,salonStatus:'active'});

test('name-only creation remains private and both entry-point checklists explain what is missing',()=>{
  const s={business_name:'Reylumi Test – Drako',public_discovery_enabled:false};
  const p=getSalonProfileReadiness({setting:s,looks:[],services:[],staff:[]});
  const d=getSalonDiscoveryReadiness({setting:s,activeServiceCount:0,salonStatus:'active'});
  assert.equal(p.canPublish,false);assert.equal(d.canEnable,false);assert.equal(p.isExploreEligible,false);
  assert(p.missingRequiredItems.includes('At least one active service'));
  assert(!p.missingRequiredItems.includes('Active team members'));
});

test('every existing enforced profile prerequisite remains enforced and is labeled required',()=>{
  assert.equal(profile().canPublish,true);
  for(const key of ['business_name','phone','address_line1','city','state','postal_code','public_profile_tagline','public_profile_logo_path','public_profile_cover_path']){
    const r=profile({[key]:' '});assert.equal(r.canPublish,false,key);
    assert.deepEqual(r.missingRequiredItems,r.items.filter(i=>i.required&&!i.complete).map(i=>i.label));
  }
  for(const list of ['looks','services']){
    const input={setting,looks:[{status:'published'}],services:[{is_active:true}],staff:[],[list]:[]};
    assert.equal(getSalonProfileReadiness(input).canPublish,false,list);
  }
});

test('discovery preserves active salon, description, contact/address and active-service requirements',()=>{
  assert.equal(discovery().canEnable,true);
  for(const key of ['business_name','phone','address_line1','city','state','postal_code','business_description']) assert.equal(discovery({[key]:''}).canEnable,false,key);
  assert.equal(getSalonDiscoveryReadiness({setting,activeServiceCount:0,salonStatus:'active'}).canEnable,false);
  assert.equal(getSalonDiscoveryReadiness({setting,activeServiceCount:1,salonStatus:'disabled'}).canEnable,false);
});

test('optional fields and active team do not become publishing/Explore prerequisites',()=>{
  assert.equal(profile({website:null,public_profile_story:null}).canPublish,true);
  assert.equal(discovery({email:null,website:null,public_profile_tagline:null,public_profile_logo_path:null,public_profile_cover_path:null}).canEnable,true);
  // Current policy differences are preserved, pending owner approval to consolidate.
  assert.equal(profile({business_description:null}).canPublish,true);
});

test('checklist completion never enables publication by itself',()=>{
  assert.equal(profile().status,'ready');assert.equal(profile().isExploreEligible,false);
});
