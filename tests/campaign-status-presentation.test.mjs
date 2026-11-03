import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/campaign-status.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {campaignStatus,campaignIsActive}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const now=Date.parse('2026-10-21T12:00:00Z'),episode='00000000-0000-0000-0000-000000000001';
const base={status:'running',starts_at:'2026-10-20T00:00:00Z',ends_at:'2026-10-21T11:59:59Z'};

test('expired campaigns disclose pending reconciliation instead of settled success or invalid legacy controls',()=>{
  for(const status of ['running','paused']){
    const s=campaignStatus({...base,status},now);assert.equal(s.label,'Period ended — awaiting reconciliation');assert.equal(s.awaitingReconciliation,true);assert.equal(s.canPause,false);assert.equal(s.canResume,false);
  }
  assert.equal(campaignStatus({...base,status:'completed'},now).label,'Finished');
  assert.equal(campaignIsActive({...base,status:'completed'}),false);
});
test('legacy settled pause requires a new period; retained pause resumes its existing reserve',()=>{
  const paused={...base,status:'completed',owner_paused_at:'2026-10-20T12:00:00Z',pause_episode_id:episode};
  const s=campaignStatus(paused,now);assert.equal(s.label,'Paused · period ended');assert.equal(s.canPause,false);assert.equal(s.canResume,true);assert.equal(s.resumeNewPeriod,true);assert.equal(campaignIsActive(paused),true);
  const held=campaignStatus({...paused,status:'paused'},now);assert.equal(held.label,'Paused');assert.equal(held.awaitingReconciliation,false);assert.equal(held.resumeNewPeriod,false);assert.equal(held.canResume,true);
});
test('current-period Resume needs an exact episode and does not become a new-period request',()=>{
  const paused={...base,status:'paused',ends_at:'2026-10-22T00:00:00Z',owner_paused_at:'2026-10-21T11:00:00Z',pause_episode_id:episode};
  assert.equal(campaignStatus(paused,now).canResume,true);assert.equal(campaignStatus(paused,now).resumeNewPeriod,false);
  for(const pause_episode_id of [null,'',undefined,'stale-shape'])assert.equal(campaignStatus({...paused,pause_episode_id},now).canResume,false);
  assert.equal(campaignStatus({...base,starts_at:'2026-10-22T00:00:00Z',ends_at:'2026-10-23T00:00:00Z'},now).label,'Scheduled');
});

test('an unmarked admin Pause retains current-period Resume; an old episode alone is not owner intent',()=>{
  for(const pause_episode_id of [null,episode]){
    const paused={...base,status:'paused',ends_at:'2026-10-22T00:00:00Z',owner_paused_at:null,pause_episode_id};
    const state=campaignStatus(paused,now);
    assert.equal(state.ownerPaused,false);assert.equal(state.canResume,true);assert.equal(state.resumeNewPeriod,false);
    assert.equal(campaignStatus({...paused,ends_at:base.ends_at},now).canResume,false);
    assert.equal(campaignIsActive({...paused,status:'completed'}),false);
  }
});
