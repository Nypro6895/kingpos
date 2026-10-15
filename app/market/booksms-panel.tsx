'use client';
import {useState,useTransition} from 'react';
import {saveBookSms} from './booksms-actions';
import {EMPTY_BOOKSMS,type BookSmsState} from '@/types/booksms';
export function BookSmsPanel({initial=EMPTY_BOOKSMS,plannedLimit=0}:{initial?:BookSmsState;plannedLimit?:number}) {
 const [state,setState]=useState(initial),[message,setMessage]=useState(''),[pending,start]=useTransition();
 return <section className="mt-5 rounded-xl border p-5"><h3 className="font-semibold">BookSMS settings</h3><p className="my-3 text-sm">{state.active?'Paid access is active for this salon.':'No active paid access. Review the BookSMS plan in Market before purchasing.'}</p>
 <p className="mb-3 text-sm">{plannedLimit>0?`Plan allowance: ${plannedLimit} SMS per calendar month (UTC).`:"Price and SMS allowance are pending approval. Purchases are closed."}</p>
 <p className="mb-4 text-sm text-zinc-500">Booking confirmations and appointment reminders use this plugin’s sender. Reylumi account verification uses the system configuration.</p>
 <form key={`${state.installed}:${state.enabled}`} action={form=>start(async()=>{const result=await saveBookSms(form);if(result.state)setState(result.state);setMessage(result.error??result.message??'');})} className="grid gap-4">
 <fieldset disabled={pending || !state.active} className="grid gap-4 disabled:opacity-60">
 <label className="flex gap-3"><input type="checkbox" name="installed" defaultChecked={state.installed}/>Activate BookSMS for this salon</label>
 <label className="flex gap-3"><input type="checkbox" name="enabled" defaultChecked={state.enabled}/>Enable booking SMS delivery</label>
 <label className="flex gap-3"><input type="checkbox" name="confirmation" defaultChecked={state.confirmation}/>Booking confirmations and updates</label>
 <label className="flex gap-3"><input type="checkbox" name="reminders" defaultChecked={state.reminders}/>Appointment reminders within 24 hours</label>
 {([['accountSid','Account SID'],['messagingServiceSid','Messaging Service SID'],['from','Sender phone (if no Messaging Service)']] as const).map(([name,label])=><label className="grid gap-2 text-sm" key={name}>{label}<input name={name} defaultValue={state[name]} autoComplete="off" className="rounded-lg border p-3"/></label>)}
 <label className="grid gap-2 text-sm">Auth Token<input type="password" name="authToken" autoComplete="new-password" placeholder={state.tokenConfigured?'Leave blank to keep the saved token':'Enter Auth Token'} className="rounded-lg border p-3"/></label>
 <p className="text-sm">SMS allowance: {state.monthlyLimit>0?`${state.monthlyLimit} per month`:'Pending plan configuration; sending remains disabled'}. Provider fees may apply.</p>
 <button className="rounded-lg bg-zinc-900 px-4 py-3 text-white" type="submit">{pending?'Saving…':'Save BookSMS settings'}</button>
 </fieldset><p role="status" className="text-sm">{message}</p></form></section>;
}
