type Settings = {enabled:boolean;accountSid:string;verifyServiceSid:string;tokenConfigured:boolean;messagingServiceSid:string;from:string};
const functions = [
 ['Personal phone verification','Profile / Account','Supabase Auth','Connected','System delivery + authentication SMS; Supabase Send SMS hook required'],
 ['SMS two-factor setup','Settings / Login Security','Supabase Auth MFA','Connected','System authentication SMS; user enrolls a phone factor'],
 ['SMS two-factor login','Login','Supabase Auth MFA','Connected','System authentication SMS; Supabase validates the code'],
 ['Login SMS alerts','Login / Login Security','System Twilio SMS sender','Connected','System delivery + login alerts + user preference'],
 ['Ownership claim SMS','Claim business','Twilio Verify','Connected','Admin delivery switch + claim SMS switch'],
 ['Ownership claim voice call','Claim business','Twilio Verify','Connected','Admin delivery switch + claim voice switch'],
 ['Business profile verification','Salon settings / Verification','Twilio SMS sender','Connected','System delivery + business verification switch'],
 ['Password recovery by SMS','Account recovery','Not implemented','Not implemented','Password reset uses email; recovery requests use support review'],
];
export function MessagingInventory({settings}:{settings:Settings}) {
 return <div className="mt-6 grid min-w-0 gap-6">
 <div className="grid gap-3 md:grid-cols-3">{[
 ['Connected delivery',settings.enabled?'Enabled':'Disabled','Saved admin policy, not a live delivery test'],
 ['Verify credentials',settings.accountSid && settings.verifyServiceSid && settings.tokenConfigured?'Present':'Incomplete','Ownership claim SMS and voice'],
 ['SMS sender details',settings.messagingServiceSid || settings.from?'Present':'Missing','Provider delivery has not been checked here'],
 ].map(([label,value,detail])=><article key={label} className="rounded-2xl border bg-white p-5"><p className="text-xs text-zinc-500">{label}</p><p className="my-2 text-xl font-semibold">{value}</p><p className="text-xs text-zinc-500">{detail}</p></article>)}</div>
 <section className="min-w-0 rounded-2xl border bg-white p-6" aria-labelledby="messaging-inventory"><h2 id="messaging-inventory" className="text-lg font-semibold">System function inventory</h2><p className="mt-2 text-sm text-zinc-500">Integration status describes the current application logic. Authentication SMS requires the Supabase Send SMS hook to be connected. Saved credentials do not confirm live provider delivery.</p>
 <div className="mt-5 min-w-0 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Function / location','Provider','Admin integration','Current control'].map(label=><th key={label} scope="col" className="border-b p-3 text-xs font-medium text-zinc-500">{label}</th>)}</tr></thead><tbody>{functions.map(([name,location,provider,status,control])=><tr key={name}><td className="min-w-48 border-b border-zinc-100 p-3 align-top"><strong>{name}</strong><span className="mt-1 block text-xs text-zinc-500">{location}</span></td><td className="border-b border-zinc-100 p-3 align-top">{provider}</td><td className="border-b border-zinc-100 p-3 align-top"><span className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs ${status==='Connected'?'bg-emerald-50 text-emerald-700':'bg-zinc-100 text-zinc-600'}`}>{status}</span></td><td className="border-b border-zinc-100 p-3 align-top">{control}</td></tr>)}</tbody></table></div>
 <p className="mt-5 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600">Booking SMS uses BookSMS in Market, with separate salon credentials, paid access, delivery preferences and SMS allowance. Call salon and Share by SMS buttons open the visitor’s phone app and do not use Twilio.</p></section></div>;
}
