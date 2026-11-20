import { WorkspaceText } from "@/components/workspace-language";
const money=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);

export function PosCollectionBreakdown({service,gift,discount,reward,giftPaid,earnedTip,giftTipPaid,expected,expectedTip}:{
  service:number;gift:number;discount:number;reward:number;giftPaid:number;earnedTip:number;giftTipPaid:number;expected:number;expectedTip:number;
}) {
  const row=(label:string,value:number,negative=false)=><div className="flex items-baseline justify-between gap-4"><dt><WorkspaceText text={label}/></dt><dd className="shrink-0 tabular-nums">{negative?"−":""}{money(value)}</dd></div>;
  return <div className="grid gap-6 rounded-xl border border-stone-200 bg-stone-50/50 p-4 text-sm text-zinc-600 sm:grid-cols-2" data-pos-collection-breakdown>
    <dl className="space-y-2">
      {row("Services",service)}{gift>0&&row("Gift cards sold",gift)}
      {discount>0&&row("Discount",discount,true)}{reward>0&&row("Reward used",reward,true)}{giftPaid>0&&row("Paid with Gift card",giftPaid,true)}
      <div className="border-t border-stone-200 pt-3 font-semibold text-zinc-950">{row("Expected collection",expected)}</div>
    </dl>
    <dl className="space-y-2">
      {row("Staff tip earned",earnedTip)}{giftTipPaid>0&&row("Tip paid with Gift card",giftTipPaid,true)}
      <div className="border-t border-stone-200 pt-3 font-semibold text-zinc-950">{row("Tip to collect",expectedTip)}</div>
    </dl>
  </div>;
}
