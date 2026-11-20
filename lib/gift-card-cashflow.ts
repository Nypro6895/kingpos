export function giftCashflow(value: unknown) {
  const row=value as { counterSales?:unknown;redeemed?:unknown;serviceRedeemed?:unknown;tipRedeemed?:unknown }|null;
  const integer=(n:unknown)=>{const v=Number(n??0);if(!Number.isSafeInteger(v)||v<0)throw new Error("Gift card reconciliation amount is invalid.");return v;};
  const counterSales=integer(row?.counterSales),redeemed=integer(row?.redeemed);
  const serviceRedeemed=integer(row?.serviceRedeemed),tipRedeemed=integer(row?.tipRedeemed);
  if(serviceRedeemed+tipRedeemed>redeemed)throw new Error("Gift card source allocation is invalid.");
  return {counterSales,redeemed,serviceRedeemed,tipRedeemed,adjustment:counterSales-redeemed};
}
