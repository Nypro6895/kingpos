import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {mkdirSync} from 'node:fs';

test('existing booking options show independent radio/checkbox groups and update price and duration',{
  skip:!process.env.TEST_BROWSER_PATH,timeout:60000,
},async()=>{
  const contents=`import React from 'react';import{createRoot}from'react-dom/client';import{PublicBookingClient}from'./app/book/[salonId]/public-booking-client';
    const service=(id,name,basePrice,durationMinutes,group)=>({id,name,basePrice,durationMinutes,addOnGroup:group,isAddOnOnly:!!group,addOnIds:group?[]:['gel','french','massage','paraffin'],category:'Pedicure',description:null});
    const data={state:'ready',salon:{salonId:'salon',name:'Fixture salon',publicProfileEnabled:true},settings:{anyProfessionalEnabled:true,splitStaffAppointmentEnabled:true,guestBookingEnabled:true,confirmationMode:'instant_booking',timezoneIana:'America/Chicago',maximumAdvanceWindowDays:60,minimumLeadTimeMinutes:0,slotIntervalMinutes:5,sameDayBookingEnabled:true},currentUser:null,
    services:[service('pedi','Spa pedi',40,45),service('gel','Gel polish',15,15,'one'),service('french','French polish',10,10,'one'),service('massage','Extra massage',10,10,'many'),service('paraffin','Paraffin',12,10,'many')],staff:[{id:'anna',displayName:'Anna',avatarUrl:null}],staffByService:{pedi:['anna'],gel:['anna'],french:['anna'],massage:['anna'],paraffin:['anna']},slots:[],initialSelection:{serviceId:null,serviceIds:[],staffId:null,staffMode:'any',date:'2099-10-02',addOnSelections:[],addOnServiceIds:[],initialStep:0,source:'public_profile',inspiration:null}};
    createRoot(document.getElementById('root')).render(<PublicBookingClient data={data}/>);`;
  const result=await build({stdin:{contents,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'fixture',setup(b){
    b.onResolve({filter:/explore-account-actions$/},()=>({path:'account',namespace:'stub'}));
    b.onResolve({filter:/app\/book\/actions$|public-booking-availability-client$|public-booking-submit-client$|next\/navigation$/},args=>({path:args.path,namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='account'?'export const useExploreAuthenticated=()=>false;':args.path==='next/navigation'?'export const usePathname=()=>"/book/salon";export const useRouter=()=>({replace(){}});':`export async function loadPublicBookingSlotsAction(){return []}export async function loadPublicBookingAvailabilityHintsAction(input){return input.scopes.map(s=>({key:s.key,status:'unavailable'}))}export async function createPublicBookingAction(){throw Error('Submission not used in fixture')}` }));
  }}]});
  const css=result.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
  const script=result.outputFiles.find(f=>f.path.endsWith('.js')).text;
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(7000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    // Exercise the actual bundled UI without network/loopback access or live requests.
    await page.setContent(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({content:script});
    await page.getByRole('checkbox',{name:'Spa pedi',exact:true}).check();
    await page.getByRole('button',{name:/Options/}).click();
    const dialog=page.getByRole('dialog');
    try {await dialog.waitFor();} catch(error) {
      console.error('Booking fixture errors:',errors);
      console.error('Booking fixture content:',await page.locator('body').innerText());
      throw error;
    }
    const one=dialog.getByRole('group',{name:/Choose one/}),many=dialog.getByRole('group',{name:/Choose multiple/});
    assert.equal(await one.getByRole('radio').count(),3);assert.equal(await many.getByRole('checkbox').count(),2);
    await one.getByRole('radio',{name:'Gel polish',exact:true}).check();
    await one.getByRole('radio',{name:'French polish',exact:true}).check();
    assert.equal(await one.getByRole('radio',{name:'Gel polish',exact:true}).isChecked(),false);
    await many.getByRole('checkbox',{name:'Extra massage',exact:true}).check();
    await many.getByRole('checkbox',{name:'Paraffin',exact:true}).check();
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    assert.match(await page.locator('footer').innerText(),/\$72(?:\.00)? est/);
    assert.match(await page.locator('footer').innerText(),/1 hr 15 min|75 min/);
    assert.equal(await page.getByRole('checkbox',{name:'Gel polish',exact:true}).count(),0,'extra is absent from the main service list');
    assert.deepEqual(errors,[]);
    mkdirSync('artifacts/service-addon-groups-20261017',{recursive:true});
    await page.screenshot({path:'artifacts/service-addon-groups-20261017/booking-extras.png',fullPage:true});
  }finally{await browser.close();}
});
