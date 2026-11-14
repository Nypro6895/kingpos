import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import type { PosTicketWithRelations } from "@/types/pos-ticket";
import type { PosPayment } from "@/types/pos-payment";

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const ticketPaymentLabel = (method: string) => ({cash:"Cash",credit_card:"Card",debit_card:"Debit card",gift_card:"Gift card",other:"Other"})[method] ?? method;

/** Search the retail item shown on a Ticket without attributing its operator to service work. */
export function ticketGiftSearchValues(sources: PosTicketWithRelations["financial_sources"]) {
  return (sources?.giftSales ?? []).flatMap(sale => [
    "Gift card", sale.last4, String(sale.amountCents / 100), (sale.amountCents / 100).toFixed(2),
  ]);
}

/** Receipt projection only. Never use retail totals to allocate wages or turns. */
type FinancialTicket = Pick<PosTicketWithRelations,"financial_sources"|"discount_type"|"discount_value"|"tax_rate"|"tip_type"|"tip_value"|"opened_at"> & {
  created_at?: string; closed_at?: string | null;
  ticket_items: Array<{line_total:number;is_removed?:boolean}>;
  payments?: Array<Pick<PosPayment,"amount"|"payment_method"|"created_at">>;
};
export function ticketFinancialView(ticket: FinancialTicket, serviceTotals = calculateTicketTotals({
  items: ticket.ticket_items.filter(item => !item.is_removed), payments: ticket.payments ?? [],
  discountType: ticket.discount_type, discountValue: Number(ticket.discount_value),
  taxRate: Number(ticket.tax_rate), tipType: ticket.tip_type, tipValue: Number(ticket.tip_value),
})) {
  const giftSales = ticket.financial_sources?.giftSales ?? [];
  const giftSold = money(giftSales.reduce((sum, sale) => sum + sale.amountCents / 100, 0));
  const giftRedeemed = money((ticket.financial_sources?.giftRedeemedCents ?? 0) / 100);
  const reward = money(Math.min(serviceTotals.discount_amount, ticket.financial_sources?.rewardDiscount ?? 0));
  const recordedPayments = ticket.payments ?? (ticket.financial_sources?.recordedPayments ?? []).map(payment=>({amount:payment.amount,payment_method:payment.paymentMethod,created_at:payment.createdAt}));
  const payments = recordedPayments.map(payment => ({amount:Number(payment.amount),method:ticketPaymentLabel(payment.payment_method),created_time:payment.created_at}));
  // Older POS records classify the full service payment as Other. The Gift
  // ledger identifies the already-paid part; relabel it rather than adding it.
  let unclassifiedGift = money(Math.max(0, giftRedeemed - recordedPayments.filter(payment => payment.payment_method === "gift_card").reduce((sum, payment) => sum + Number(payment.amount), 0)));
  for (const payment of payments) {
    if (unclassifiedGift <= 0 || payment.method !== "Other") continue;
    const applied = Math.min(payment.amount, unclassifiedGift);
    payment.amount = money(payment.amount - applied);
    unclassifiedGift = money(unclassifiedGift - applied);
  }
  const reclassifiedGift = money(giftRedeemed - unclassifiedGift - recordedPayments.filter(payment => payment.payment_method === "gift_card").reduce((sum,payment) => sum + Number(payment.amount),0));
  if (reclassifiedGift > 0) payments.push({amount:reclassifiedGift,method:"Gift card",created_time:ticket.closed_at ?? ticket.created_at ?? ticket.opened_at});
  for (const sale of giftSales) payments.push({amount:sale.amountCents/100,method:ticketPaymentLabel(sale.paymentMethod),created_time:sale.createdAt});
  const paid = money(recordedPayments.reduce((sum,payment)=>sum+Number(payment.amount),0) + giftSold);
  const total = money(serviceTotals.total + giftSold);
  return {
    giftSales, giftSold, giftRedeemed, reward, ordinaryDiscount: money(Math.max(0,serviceTotals.discount_amount-reward)),
    giftOnly: giftSales.length > 0 && !ticket.ticket_items.some(item => !item.is_removed),
    payments: [...payments.reduce((grouped,payment)=>{const previous=grouped.get(payment.method);grouped.set(payment.method,previous?{...previous,amount:money(previous.amount+payment.amount)}:payment);return grouped;},new Map<string,(typeof payments)[number]>()).values()].filter(payment => payment.amount !== 0),
    totals: {...serviceTotals,subtotal:money(serviceTotals.subtotal+giftSold),paid,total,remaining:money(total-paid)},
  };
}
