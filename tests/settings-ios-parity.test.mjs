import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8').replaceAll('\r\n','\n');
test('installed Salon Settings retains every web form field, permission and compact page',()=>{
 const web=read('app/(app)/salon-settings/page.tsx'),local=read('components/app-local-salon-settings.tsx');
 const helpers=s=>s.slice(s.indexOf('const OPERATING_WEEK_DAYS'),s.indexOf(s===web?'async function SalonSettingsPage':'export function AppLocalSalonSettings')).trim();
 assert.equal(helpers(local),helpers(web),'Both renderers must preserve the same action payloads and validation');
 const render=web.slice(web.indexOf('  const items = ['),web.indexOf('\nexport default withExperiencePage')).replaceAll('isOwnerMembership(context.currentMembership)','isOwner').replaceAll('context.currentSalon.id','salonId');
 assert.equal(local.slice(local.indexOf('  const items = [')).trim(),render.trim());
 for(const id of ['business-information','public-profile-discovery','operating-hours','staff-appointment-permission','public-team','ownership-admins','salon-status'])assert.ok(local.includes(`id:"${id}"`),id);
 assert.ok(read('lib/app-local-reference-content.ts').includes('app/settings/settings-hub-client.tsx'));
 assert.ok(read('app/settings/settings-hub-client.tsx').includes('"./compact-settings.css"'));
});
