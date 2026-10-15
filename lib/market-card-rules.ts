export const CARD_PLUGINS = ['vietnamese-language','booking-policy','booking-deposit','checkin-receipt'] as const;
export function validCardQuote(subscription: {items?:{data?:Array<{quantity:number;price:{unit_amount:number;currency:string;recurring?:{interval:string;interval_count:number}}}>}}, cents:number) {
 const items=subscription.items?.data, item=items?.[0];
 return items?.length===1 && item?.quantity===1 && item.price.unit_amount===cents && item.price.currency==='usd' && item.price.recurring?.interval==='month' && item.price.recurring.interval_count===1;
}
export function cardMoney(value:number) {return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);}
