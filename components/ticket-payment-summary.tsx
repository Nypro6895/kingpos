import {WorkspaceText} from "@/components/workspace-language";
const money=(amount:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(amount);

export function TicketPaymentSummary({payments,timeZone}:{payments:Array<{method:string;amount:number;created_time:string}>;timeZone:string}) {
  return <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm" data-ticket-recorded-payments>
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500 sm:grid-cols-3"><span><WorkspaceText text="Method"/></span><span><WorkspaceText text="Amount"/></span><span className="hidden sm:block"><WorkspaceText text="Recorded"/></span></div>
    <ul className="divide-y divide-zinc-100">{payments.map((payment,index)=><li key={payment.method+index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-3"><strong className="font-medium"><WorkspaceText text={payment.method}/></strong><span className="tabular-nums">{money(payment.amount)}</span><span className="col-span-2 text-xs text-zinc-500 sm:col-span-1">{new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone}).format(new Date(payment.created_time))}</span></li>)}</ul>
  </div>;
}
