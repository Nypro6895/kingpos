import type { CommerceWorkspace } from "./server";
// Integer cents throughout. Pending quotes are never counted as captured money.
export function commerceSummary(workspace: CommerceWorkspace) {
  const result={pending:BigInt(0),captured:BigInt(0),refunded:BigInt(0),disputedPrincipal:BigInt(0),quotedPlatformFees:BigInt(0),quotedSellerShares:BigInt(0),paidBankPayouts:BigInt(0),pendingBankPayouts:BigInt(0),failedBankPayouts:BigInt(0)};
  for(const order of workspace.orders){
    const amount=BigInt(order.amount_cents),fee=BigInt(order.fee_cents),refund=BigInt(order.refunded_cents);
    if(!order.charge_id){if(order.state==='pending')result.pending+=amount;continue;}
    result.captured+=amount;result.refunded+=refund;result.quotedPlatformFees+=fee;result.quotedSellerShares+=amount-fee;
    if(order.disputed)result.disputedPrincipal+=amount-refund;
  }
  for(const payout of workspace.payouts){if(payout.currency!=='usd')throw Error('Unsupported accounting currency');const amount=BigInt(payout.amount_cents);if(payout.status==='paid')result.paidBankPayouts+=amount;else if(['pending','in_transit'].includes(payout.status))result.pendingBankPayouts+=amount;else if(payout.status==='failed')result.failedBankPayouts+=amount;}
  return {...result,retainedGross:result.captured-result.refunded};
}
export function dollars(cents:bigint){const abs=cents<BigInt(0)?-cents:cents;return `${cents<BigInt(0)?'-':''}$${abs/BigInt(100)}.${String(abs%BigInt(100)).padStart(2,'0')}`;}
