'use client';
import {useActionState} from 'react';
import {saveTwilioSettingsAction} from './actions';
type Settings={accountSid:string;verifyServiceSid:string;messagingServiceSid:string;from:string;enabled:boolean;claimSms:boolean;claimVoice:boolean;tokenConfigured:boolean};
export function TwilioSettingsForm({settings}:{settings:Settings}) {
 const [state,action,pending]=useActionState(saveTwilioSettingsAction,{message:'',ok:false});
 return <form action={action} className="mt-6 grid max-w-2xl gap-5 rounded-2xl border bg-white p-6">
 <label className="flex gap-3"><input type="checkbox" name="enabled" defaultChecked={settings.enabled}/>Enable Twilio messaging</label>
 {([['accountSid','Account SID'],['verifyServiceSid','Verify Service SID'],['messagingServiceSid','Messaging Service SID (optional, for booking SMS)'],['from','Sender phone (optional, if no Messaging Service)']] as const).map(([key,label])=><label className="grid gap-2 text-sm" key={key}>{label}<input name={key} defaultValue={settings[key]} className="rounded-lg border p-3" autoComplete="off" required={key==='accountSid'||key==='verifyServiceSid'}/></label>)}
 <label className="grid gap-2 text-sm">Auth Token<input type="password" name="authToken" autoComplete="new-password" className="rounded-lg border p-3" placeholder={settings.tokenConfigured?'Configured — leave blank to keep existing token':'Enter Auth Token'} required={!settings.tokenConfigured}/></label>
 <p className="text-sm text-zinc-500">The token is encrypted and never displayed. Changes are recorded in the admin audit log.</p>
 <fieldset className="grid gap-3"><legend className="mb-2 font-medium">Claim verification methods</legend><label className="flex gap-3"><input type="checkbox" name="claimSms" defaultChecked={settings.claimSms}/>SMS codes</label><label className="flex gap-3"><input type="checkbox" name="claimVoice" defaultChecked={settings.claimVoice}/>Phone calls</label></fieldset>
 <p className="text-sm text-zinc-500">Configure six-digit codes and enable SMS/Voice in Twilio Verify. Calls require a keypad response. Booking SMS also needs an approved sender.</p>
 {state.message?<p role="status" className={state.ok?'text-green-700':'text-red-700'}>{state.message}</p>:null}
 <div className="flex flex-wrap gap-3"><button disabled={pending} name="intent" value="save" className="rounded-lg bg-zinc-900 px-4 py-3 text-white disabled:opacity-50">{pending?'Checking…':'Save settings'}</button><button disabled={pending} name="intent" value="test" className="rounded-lg border px-4 py-3 disabled:opacity-50">Test connection</button></div>
 </form>;
}
