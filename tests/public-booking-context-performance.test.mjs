import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

test('selected dates read only nearby conflicts; earliest search keeps the full window', {skip:!process.env.ESBUILD_MODULE_PATH}, async()=>{
  const source=readFileSync('lib/public-booking.ts','utf8');
  const fn=source.slice(source.indexOf('async function loadRawContext('),source.indexOf('function unavailablePage('));
  const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const built=await build({stdin:{contents:`const MAX_PUBLIC_SLOT_DAYS=45;const cleanDate=v=>/^\u005cd{4}-\u005cd{2}-\u005cd{2}$/.test(v??'')?v:null;const addDays=(d,n)=>new Date(+d+n*86400000);const createSupabaseServerClient=()=>({rpc:async(name,args)=>{globalThis.rangeCalls.push(args);return {data:{},error:null};}});const loadPublicContentBookingOptions=async()=>[];const parseContextPayload=v=>v;`+fn+'export{loadRawContext};',loader:'ts'},write:false,format:'esm',platform:'node'});
  const {loadRawContext}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  globalThis.rangeCalls=[];
  try{
    await loadRawContext('salon',{includeContentOptions:false,rangeDate:'2026-11-01'});
    assert.equal(rangeCalls[0].p_range_start,'2026-10-31T00:00:00.000Z');
    assert.equal(rangeCalls[0].p_range_end,'2026-11-03T00:00:00.000Z','padding spans DST and any salon offset');
    await loadRawContext('salon',{includeContentOptions:false});
    assert.equal(Date.parse(rangeCalls[1].p_range_end)-Date.parse(rangeCalls[1].p_range_start),46*86400000);
    await loadRawContext('salon',{includeContentOptions:false,metadataOnly:true});
    assert.equal(Date.parse(rangeCalls[2].p_range_end)-Date.parse(rangeCalls[2].p_range_start),1);
  }finally{delete globalThis.rangeCalls;}
});
