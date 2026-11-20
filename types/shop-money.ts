export type MoneySource = "cash" | "bank" | "other";
export type ShopCollection = {business_date:string;cash:number;card:number;other:number;note:string;revision:number;updated_at:string;legacy_snapshot?:{cash:number;card:number;other:number;tip:number;entered:boolean}|null};
export type ShopExpense = {id:string;business_date:string;paid_at:string;amount:number;category:"supplies"|"rent"|"card_fee"|"other"|"tax_payment";source:MoneySource;note:string;revision:number;recurrence_key:string|null};
export type ShopMoneyHistory = {id:string;business_date:string;kind:string;object_id:string;before_value:Record<string,unknown>|null;after_value:Record<string,unknown>;created_at:string;actor_id:string};
export type ShopMoneyData = {
 cardTransactions:number;today:string;timezone:string;days:{date:string;expected:number}[];
 collections:ShopCollection[];legacy:{business_date:string;cash:number;card:number;other:number;tip:number;entered:boolean;updated_at:string}[];
 expenses:ShopExpense[];settings:{rent:number;rent_day:number;fee_rate:number;fee_each:number;revision:number}|null;
 opening:{cash:number;bank:number;other:number;tax:number;revision:number}|null;
 giftOpening:number;giftClosing:number;giftActivity:{id:string;created_at:string;kind:string;delta:number;ticket_id:string|null;last4:string}[];
 rewardOpening:number;rewardClosing:number;rewardSummary:{issued:number;spent:number;adjustments:number};
 rewardCredits:number;rewardDebits:number;
 rewardActivity:{id:string;created_at:string;delta:number;reason:string;ticket_id:string|null;user_id:string;customer_name?:string|null;ticket_number?:string|null}[];
 discounts:{id:string;ticket_number:string|null;opened_at:string;total:number;reward:number}[];
 history:ShopMoneyHistory[];
};
