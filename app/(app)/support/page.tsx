import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";
import {cookies} from "next/headers";
import {getGuestSupport} from "@/lib/guest-support";
import {supportStatus} from "@/lib/support-case-labels";
import Link from "next/link";
import {supportRpc,type SupportCaseItem} from "@/lib/support-cases";
import {SupportRequestForm} from "@/app/support/support-ui";
async function SupportPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const params=await searchParams;const raw=typeof params.from==="string"?params.from:"";
 const source=raw.startsWith("/")&&!raw.startsWith("//")?raw.split("?")[0].slice(0,500):"";
 const guestRequests=await Promise.all((await cookies()).getAll().filter(c=>c.name.startsWith("support-case-")).slice(0,10).map(async cookie=>{const id=cookie.name.slice("support-case-".length);try{return {threadId:id,case:await getGuestSupport(id)};}catch{return null;}}));
 const cases=await supportRpc<SupportCaseItem[]>("list_my_support_cases");
 return <main className="mx-auto max-w-5xl px-4 py-6 sm:px-8"><header className="mb-6"><h1 className="text-xl font-semibold"><WorkspaceText text="Report / Contact" /></h1><p className="mt-1 text-sm text-zinc-500"><WorkspaceText text="Report an issue and continue conversations with our team." /></p></header>{cases===null?<div className="grid gap-3"><Link href="/contact-support" className="text-orange-700 underline"><WorkspaceText text="Contact support without signing in" /></Link>{guestRequests.filter(Boolean).map(r=>r?<Link key={r.threadId} href={`/support/guest/${r.threadId}`} className="block border-b border-zinc-200 py-4 text-sm">{r.case.summary} · <WorkspaceText text={supportStatus[r.case.status]} /></Link>:null)}<Link href="/login?next=/support" className="underline"><WorkspaceText text="Sign in to view your requests" /></Link></div>:<div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><section><h2 className="mb-4 font-semibold"><WorkspaceText text="Send a request" /></h2><SupportRequestForm source={source} category={source.includes("payroll")||source.includes("reports")?"data_calculation":source.includes("booking")?"booking":source.includes("ticket")||source.includes("pos")?"ticket":"app_issue"}/></section><section><h2 className="mb-4 font-semibold"><WorkspaceText text="My requests" /></h2><div className="divide-y divide-zinc-200">{cases.length?[...cases].sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at)).map(c=><Link key={c.id} href={`/support/${c.id}`} className="block py-4 hover:bg-zinc-50"><span className="block break-words text-sm font-semibold">{c.summary}</span><span className="text-xs text-zinc-500">{c.reference} · <WorkspaceText text={supportStatus[c.status]||c.status} /></span><RequestDate value={c.updated_at} /></Link>):<p className="text-sm text-zinc-500"><WorkspaceText text="Your requests and replies will appear here." /></p>}</div></section></div>}</main>;
}

function RequestDate({value}:{value:string}) {
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))return null;
 return <time dateTime={date.toISOString()} className="mt-1 block text-xs text-zinc-500"><WorkspaceText text="Last updated" />: {new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/Chicago",timeZoneName:"short"}).format(date)}</time>;
}

export default withExperiencePage(SupportPage);
