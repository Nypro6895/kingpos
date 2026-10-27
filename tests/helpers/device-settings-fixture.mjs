import { resolve, dirname } from 'node:path';
export function deviceSettingsFixture() {
  return {name:'device-settings-actions',setup(builder){
    builder.onResolve({filter:/actions$/},args=>{
      const path=args.path.startsWith('@/')?resolve(args.path.slice(2)):resolve(dirname(args.importer),args.path);
      if(path.replaceAll(String.fromCharCode(92),'/').endsWith('/app/pos/settings/actions'))return {path:'settings',namespace:'device-settings-fixture'};
    });
    builder.onLoad({filter:/.*/,namespace:'device-settings-fixture'},()=>({contents:`export async function loadDeviceDisplayAppearance(){return {error:'Sign in to Owner Settings to manage salon images and promotions.'}};export async function savePosSettingsGroup(){return {ok:true,snapshot:{}};}`}));
  }};
}
