"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { useNativeDialogNavigation, useTransientOverlay } from "@/components/overlay-dismissal";
import { WorkspaceText } from "@/components/workspace-language";
import { customerCheckoutView } from "@/lib/customer-checkout-view";
import type { PosLiveDraftView } from "@/types/pos-desk";
import type { RewardView } from "@/types/rewardlumi";
import type { GiftSession } from "@/types/gift-card";
import "./customer-checkout.css";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export type TipReceiptScope = { draftId: string; customerVersion: number; receiptVersion: number };
export type CheckoutReceiptSettings = { customerShowServiceName: boolean; customerShowStaffName: boolean; customerShowReceiptStatus: boolean; customerShowSalonName: boolean; salonName: string | null; salonLogoUrl: string | null };

export function CustomerCheckoutHeader({ settings }: { settings: CheckoutReceiptSettings }) {
  return <header className="customer-checkout-header"><div>{settings.salonLogoUrl && <img className="customer-checkout-salon-logo" src={settings.salonLogoUrl} alt="" />}{settings.customerShowSalonName && <strong>{settings.salonName || "Welcome"}</strong>}<small><WorkspaceText text="Thank you for visiting us today." /></small></div><img className="customer-checkout-brand" src="/brand/reylumi-logo-horizontal.png" alt="Reylumi" /></header>;
}

export function CustomerCheckoutReceipt({ liveDraft, settings, reward, gift, rewardsAvailable = true }: { liveDraft: PosLiveDraftView | null; settings: CheckoutReceiptSettings; reward: RewardView | null; gift: GiftSession | null; rewardsAvailable?: boolean }) {
  const view = customerCheckoutView(liveDraft, reward, gift);
  const lines = liveDraft?.staff_lines ?? [];
  return <section className="customer-checkout-receipt" data-customer-display-summary data-customer-display-full-receipt data-checkout-hide-staff={!settings.customerShowStaffName || undefined}>
    <header className="customer-checkout-receipt-heading"><p><WorkspaceText text="A beautiful finish" /></p><h1 data-customer-display-receipt-title><WorkspaceText text="Your receipt" /></h1><span><WorkspaceText text="A moment to review your visit." /></span></header>
    <div className="customer-checkout-lines" data-customer-display-receipt-section>
      <div className="customer-checkout-line customer-checkout-column-heading"><span><WorkspaceText text="Services" /></span><span><WorkspaceText text="Your specialist" /></span><span><WorkspaceText text="Amount" /></span></div>
      <div className="customer-checkout-line-list" data-customer-display-receipt-lines>{lines.map((line, index) => <div className="customer-checkout-line" key={line.id} data-customer-display-receipt-line><span data-customer-display-receipt-service>{settings.customerShowServiceName ? line.label : `Service ${index + 1}`}{(line.amountParts?.length ?? 0) > 1 && <small> ×{line.amountParts!.length}</small>}</span><span data-customer-display-receipt-staff>{settings.customerShowStaffName ? line.staffName : ""}</span><span data-customer-display-receipt-amount>{money(Math.round(line.amount * 100))}</span></div>)}{view.giftPurchase>0 && <div className="customer-checkout-line customer-checkout-gift-line" data-checkout-gift-item><span><WorkspaceText text="Gift card" /><small><WorkspaceText text="A gift of beauty" /></small></span><span></span><span>{money(view.giftPurchase)}</span></div>}{!lines.length && view.giftPurchase<=0 && <p className="customer-checkout-empty"><WorkspaceText text="Waiting for services" /></p>}</div>
    </div>
    <div className="customer-checkout-summary" data-customer-display-totals>
      <div><span><WorkspaceText text="Subtotal" /></span><span>{money(Math.round((liveDraft?.subtotal ?? 0) * 100)+view.giftPurchase)}</span></div>
      {view.discount > 0 && <div><span><WorkspaceText text="Discount" /></span><span>−{money(view.discount)}</span></div>}
      <div><span><WorkspaceText text="Tax" /></span><span>{money(Math.round((liveDraft?.tax ?? 0) * 100))}</span></div>
      {view.rewardDiscount > 0 && <div data-checkout-reward-discount><span><WorkspaceText text="Reward" /> · {reward?.request?.points} <WorkspaceText text="points" /></span><span>−{money(view.rewardDiscount)}</span></div>}
      <div><span><WorkspaceText text="Tip" /></span><span>{money(Math.round((liveDraft?.tip ?? 0) * 100))}</span></div>
      {view.giftAmount > 0 && <div data-checkout-gift-reduction><span><WorkspaceText text="Gift card" />{gift?.card?.last4 ? ` · •••• ${gift.card.last4}` : ""}</span><span>−{money(view.giftAmount)}</span></div>}
      <div className="customer-checkout-grand"><span><WorkspaceText text={view.giftAmount > 0 ? "Amount due" : "Total"} /></span><output data-customer-display-receipt-total aria-live="polite">{money(view.amountDue)}</output></div>
      {rewardsAvailable && view.estimatedPoints !== null && <div className="customer-checkout-earning" data-checkout-earning><div><strong><WorkspaceText text="Rewards from this visit" /></strong><small><WorkspaceText text="Estimated · added after payment" /></small></div><b>+{view.estimatedPoints} <WorkspaceText text="pts" /></b></div>}
    </div>
  </section>;
}

export function CustomerCheckoutTip({ liveDraft, identityLabel, phone, tipOptions, isTipPending, customTipMode, customTipInput, onCustomTipInput, onSetCustomTipMode, onConfirmTip, onChangeCustomer, Keypad, benefits, giftControl, tipError, showReceiptStatus = true }: {
  liveDraft: PosLiveDraftView | null; identityLabel: string; phone: string | null;
  tipOptions: { amount: number; percentage: number }[]; isTipPending: boolean; customTipMode: boolean; customTipInput: string;
  onCustomTipInput: (value: string) => void; onSetCustomTipMode: (value: boolean) => void;
  onConfirmTip: (amount: number, closeCustom?: boolean, scope?: TipReceiptScope) => void | boolean | Promise<void | boolean>;
  onChangeCustomer: () => void; Keypad: ComponentType<{ disabled: boolean; value: string; onChange: (value: string) => void }>; benefits?: ReactNode; giftControl?: ReactNode;
  tipError?: string | null;
  showReceiptStatus?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useNativeDialogNavigation(dialog);
  useTransientOverlay(() => onSetCustomTipMode(false), customTipMode);
  const editScope = useRef<TipReceiptScope | undefined>(undefined), attempted = useRef("");
  const save = useRef(onConfirmTip);
  useEffect(() => { save.current = onConfirmTip; }, [onConfirmTip]);
  useEffect(() => { if (customTipMode) dialog.current?.showModal(); else dialog.current?.close(); }, [customTipMode]);
  const selected = liveDraft?.tip ?? 0, custom = Number(customTipInput || 0);
  const valid = /^\d{1,6}(\.\d{1,2})?$/.test(customTipInput) && Number.isFinite(custom) && custom >= 0;
  const disabled = liveDraft?.status !== "draft" || isTipPending;
  function edit(value: string) {
    if (!/^\d{0,6}(\.\d{0,2})?$/.test(value)) return;
    editScope.current = liveDraft ? { draftId: liveDraft.id, customerVersion: liveDraft.customer_version, receiptVersion: liveDraft.receipt_version } : undefined;
    attempted.current = ""; onCustomTipInput(value);
  }
  useEffect(() => {
    if (!customTipMode || !valid || isTipPending || !editScope.current || Math.round(custom * 100) === Math.round(selected * 100)) return;
    const signature = JSON.stringify([customTipInput, editScope.current]);
    if (attempted.current === signature) return;
    const timer = setTimeout(() => { attempted.current = signature; void save.current(custom, false, editScope.current); }, 650);
    return () => clearTimeout(timer);
  }, [customTipMode, valid, isTipPending, custom, selected, customTipInput]);
  async function done() {
    if (isTipPending) return;
    if (valid && Math.round(custom * 100) !== Math.round(selected * 100)) {
      if (!editScope.current) { onSetCustomTipMode(false); return; }
      attempted.current = JSON.stringify([customTipInput, editScope.current]);
      const result = await onConfirmTip(custom, false, editScope.current);
      if (result === false) return;
    }
    onSetCustomTipMode(false);
  }
  const base = liveDraft?.total_before_tip || Math.max(0, (liveDraft?.total ?? 0) - selected);
  return <section className="customer-checkout-actions" data-customer-checkout-actions>
    <header className="customer-checkout-customer"><div><strong>{identityLabel}</strong>{phone && <small>{phone}</small>}</div><button type="button" onClick={onChangeCustomer}><WorkspaceText text="Change" /></button></header>
    {benefits}
    <div className="customer-checkout-tips"><h2><WorkspaceText text="Add a tip" /></h2><p className="customer-checkout-tip-base"><WorkspaceText text="Suggestions based on" /> {money(Math.round(base * 100))}</p>
      <div className="customer-checkout-tip-options">{tipOptions.map(option => <button type="button" key={option.percentage} aria-pressed={selected === option.amount && selected > 0} disabled={disabled || base <= 0} onClick={() => void onConfirmTip(option.amount)}><strong>{option.percentage}%</strong><small>{money(Math.round(option.amount * 100))}</small></button>)}</div>
      <div className="customer-checkout-tip-extra"><button type="button" disabled={disabled} onClick={() => onSetCustomTipMode(true)}><WorkspaceText text="Custom tip" /></button><button type="button" aria-pressed={selected === 0 && !!liveDraft?.last_tip_action_id} disabled={disabled} onClick={() => void onConfirmTip(0)}><WorkspaceText text="No tip" /></button></div>
      <p className="customer-checkout-tip-status" role="status"><WorkspaceText text={isTipPending ? "Saving tip…" : liveDraft?.last_tip_action_id || selected > 0 ? "Tip saved" : "Your choice is saved automatically."} />{!isTipPending && (liveDraft?.last_tip_action_id || selected > 0) ? ` · ${money(Math.round(selected * 100))}` : ""}</p>
    </div>
    {giftControl}
    {showReceiptStatus && <p className="customer-checkout-payment-note"><WorkspaceText text="Your cashier will complete payment." /></p>}
    <dialog ref={dialog} className="customer-checkout-custom-dialog" aria-label="Custom tip" onCancel={() => onSetCustomTipMode(false)} onClose={() => onSetCustomTipMode(false)}><header><h2><WorkspaceText text="Custom tip" /></h2><button type="button" aria-label="Close custom tip" onClick={() => void done()}>×</button></header><label><WorkspaceText text="Tip amount ($)" /><input aria-label="Tip amount ($)" inputMode="decimal" disabled={isTipPending} value={customTipInput} onChange={event => edit(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void done(); } }} /></label><Keypad disabled={isTipPending} value={customTipInput} onChange={edit} /><p role="status"><WorkspaceText text={isTipPending ? "Saving tip…" : valid && custom === selected ? "Tip saved" : "Your choice is saved automatically."} /></p>{tipError && <p role="alert"><WorkspaceText text={tipError} /></p>}<button type="button" className="customer-checkout-done" disabled={isTipPending || customTipInput !== "" && !valid} onClick={() => void done()}><WorkspaceText text="Done" /></button></dialog>
  </section>;
}
