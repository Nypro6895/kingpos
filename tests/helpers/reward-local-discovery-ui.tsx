import React from 'react';
import {createRoot} from 'react-dom/client';
import {RewardDiscovery} from '../../components/rewardlumi/reward-discovery';
import {RewardOwnerPrompt} from '../../components/rewardlumi/reward-owner-prompt';
import {RewardOwner} from '../../components/rewardlumi/reward-workspaces';
import {RewardSalonPanel} from '../../components/rewardlumi/reward-salon-panel';
import {defaultRewardProgram,type RewardReply} from '../../types/rewardlumi';
const mode=new URLSearchParams(location.search).get('mode');
const setupStats={saves:0};Object.assign(window,{rewardSetupStats:setupStats});
let currentProgram=defaultRewardProgram,version=0;
const setupTransport = async(op: string,args?: Record<string,unknown>):Promise<RewardReply>=>{
 if(op==='report') return {day:'2026-11-02',timezone:'America/Chicago',source:'reward',includedInTicketDiscount:true,summary:{grossUses:0,activeUses:0,reversedUses:0,grossValueCents:0,netValueCents:0,reversedValueCents:0,pointsSpent:0,pointsReturned:0},entries:[],hasMore:false} as unknown as RewardReply;
 if(mode==='setup-real'){
  const response=await fetch('/fixture/owner',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op,args:args??{}})});const value=await response.json();if(!response.ok)throw Error(value.error);if(op==='save')setupStats.saves++;return value;
 }
 const candidate=(args?.program??currentProgram) as typeof defaultRewardProgram;
 const readiness={discoverable:candidate.enabled&&candidate.nearby&&candidate.offers.length>0,reasons:[],earning:true,usableOffers:candidate.offers.length,newCustomerOffers:candidate.offers.length,located:true,offers:candidate.offers.map(o=>({...o,serviceName:null}))};
 if(op==='preview')return {readiness};
 if(op==='save'){setupStats.saves++;version++;currentProgram=candidate;}
 return {program:currentProgram,version,readiness,members:0,services:[]};
};
function App(){
 const [area,setArea]=React.useState('Chicago, IL');
 return <div style={{maxWidth:700,margin:'auto',padding:12,fontFamily:'Arial,sans-serif'}}>
  {location.pathname.startsWith('/explore/salons/')?<RewardSalonPanel salonId={location.pathname.split('/').at(-1)!} canBook/>:mode==='owner'?<RewardOwnerPrompt/>:mode?.startsWith('setup')?<RewardOwner transport={setupTransport}/>:<>
  <label>Test area<select aria-label="Test area" value={area} onChange={e=>setArea(e.target.value)}><option>Chicago, IL</option><option>Madison, WI</option><option value="">Unknown</option></select></label>
  <RewardDiscovery location={area} viewerId={mode==='guest'?null:'test-customer'} onChooseArea={()=>setArea('Chicago, IL')}/>
  <p data-testid="unchanged-search">Original Explore search content stays available.</p>
  </>}
 </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
