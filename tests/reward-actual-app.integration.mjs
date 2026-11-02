import {randomUUID} from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';
import {rewardPracticalApp} from './helpers/reward-practical-app.mjs';
// Separate actual-page acceptance from financial settlement acceptance so a
// browser-fixture configuration retry does not rerun payment scenarios.
const f=await startIsolatedSupabase('reward-actual-pages',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'),{allowConcurrentFixtureCleanup:true});
try{
 const owner=f.person('actual-page-owner'),customer=f.person('actual-page-customer');
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Actual page acceptance'})[0].account_id;
 const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:randomUUID(),p_name:'Nearest rewards',p_owner_is_staff:false,p_phone:null,p_address_line1:null,p_address_line2:null,p_city:'Chicago',p_state:'IL',p_postal_code:'60601',p_country:'US'}).salon_id;
 f.sql(`update locations set latitude=41.88,longitude=-87.63 where id='${salon}';update salon_settings set public_discovery_enabled=true,public_discovery_published_at=now() where salon_id='${salon}';insert into services(salon_id,name,category,base_price) values('${salon}','Manicure','Nails',50);`);
 const program={enabled:true,nearby:true,spendCents:2000,spendPoints:20,welcomePoints:10,firstBookingPoints:20,visitPoints:0,conversionPoints:30,offers:[{id:'five-off',title:'$5 off',points:100,valueCents:500,minimumCents:4000}]};
 f.rpc(owner,'reward_owner',{p_salon:salon,p_op:'save',p_args:{program,expectedVersion:0}});
 // Membership fixture uses the real one-time welcome grant, no arbitrary balance.
 f.sql(`select reward_join('${salon}','${customer.profileId}')`);
 await rewardPracticalApp(f,{owner,customer,salon,account});
 console.log('PASS actual authenticated Next owner save, Explore, popup, salon context and wallet.');
}finally{f.close()}
