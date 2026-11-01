import type {ShopMoneyData} from "@/types/shop-money";
const cents=(n:unknown)=>Math.round(Number(n??0)*100);
export const money=(n:unknown)=>cents(n)/100;
export function collectionForDay(data:ShopMoneyData,date:string){
 const entry=data.collections.find(c=>c.business_date===date);
 const rawLegacy=data.legacy.find(c=>c.business_date===date);
 const legacy=rawLegacy?.entered?rawLegacy:undefined;
 // A later historical-service edit must be visible, never silently hidden by an older total entry.
 const snap=entry?.legacy_snapshot;
 const sameLegacy=!entry?false:snap===undefined?(!legacy||entry.updated_at>=legacy.updated_at):(!snap&&!rawLegacy)||!!(snap&&rawLegacy&&snap.entered===rawLegacy.entered&&['cash','card','other','tip'].every(k=>cents(snap[k as keyof typeof snap])===cents(rawLegacy[k as keyof typeof rawLegacy])));
 const useNew=entry&&sameLegacy;
 const source=useNew?entry:legacy;
 const tip=useNew?0:legacy?.tip??0;
 const cash=money(source?.cash),card=money(source?.card),other=money(source?.other);
 return {cash,card,other,unallocatedTip:money(tip),total:(cents(cash)+cents(card)+cents(other)+cents(tip))/100,revision:entry?.revision??0,note:entry?.note??"",legacy:!useNew&&!!legacy,updated:entry?.updated_at};
}
export function shopMoneyTotals(data:ShopMoneyData,payout:{cash:number;check:number;tax:number}){
 const bySource={cash:0,bank:0,other:0};let unallocated=0;
 for(const day of data.days){const c=collectionForDay(data,day.date);bySource.cash+=cents(c.cash);bySource.bank+=cents(c.card);bySource.other+=cents(c.other);unallocated+=cents(c.unallocatedTip);}
 const collected=(bySource.cash+bySource.bank+bySource.other+unallocated)/100;
 let operating=0,taxPaid=0,actualFees=0;
 for(const e of data.expenses){bySource[e.source]-=cents(e.amount);if(e.category==='tax_payment')taxPaid+=cents(e.amount);else operating+=cents(e.amount);if(e.category==='card_fee')actualFees+=cents(e.amount);}
 bySource.cash+=cents(data.opening?.cash)-cents(payout.cash);bySource.bank+=cents(data.opening?.bank)-cents(payout.check);bySource.other+=cents(data.opening?.other);
 const remaining=(bySource.cash+bySource.bank+bySource.other+unallocated)/100;
 const netTax=cents(data.opening?.tax)+cents(payout.tax)-taxPaid;
 const tax=Math.max(0,netTax)/100;
 const unmatchedTaxPayment=Math.max(0,-netTax)/100;
 const feeEstimate=actualFees===0?money((bySource.bank+cents(payout.check)-cents(data.opening?.bank)+data.expenses.filter(e=>e.source==='bank').reduce((n,e)=>n+cents(e.amount),0))/100*Number(data.settings?.fee_rate??0)/100+Number(data.cardTransactions??0)*Number(data.settings?.fee_each??0)):0;
 const available=(cents(remaining)-cents(tax)-cents(data.giftClosing)-cents(feeEstimate))/100;
 return {unmatchedTaxPayment,feeEstimate,collected,operating:operating/100,taxPaid:taxPaid/100,actualFees:actualFees/100,remaining,tax,available,gift:money(data.giftClosing),cash:bySource.cash/100,bank:bySource.bank/100,other:bySource.other/100,unallocatedTip:unallocated/100};
}
