"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import * as actions from "./scoped-market-actions";
const Target = createContext<string | undefined>(undefined);
export function MarketTargetProvider({ salonId, children }: { salonId?: string; children: ReactNode }) { return <Target.Provider value={salonId}>{children}</Target.Provider>; }
export function useMarketTargetSalon(){return useContext(Target);}
export function useScopedMarketActions(explicitSalonId?: string) {
 const inherited = useContext(Target);
 // A stale child cannot retarget a page that is already bound to another salon.
 const salonId = inherited !== undefined && explicitSalonId !== undefined && inherited !== explicitSalonId ? undefined : inherited ?? explicitSalonId;
 return useMemo(() => ({
 loadCampaignReportAction: (...args: Parameters<typeof actions.loadCampaignReportAction> extends [unknown,...infer Rest] ? Rest : never) => actions.loadCampaignReportAction(salonId,...args),
 loadOwnerCampaignAction: (...args: Parameters<typeof actions.loadOwnerCampaignAction> extends [unknown,...infer Rest] ? Rest : never) => actions.loadOwnerCampaignAction(salonId,...args),
  setServiceRelayPlugin: (...args: Parameters<typeof actions.setServiceRelayPlugin> extends [unknown, ...infer Rest] ? Rest : never) => actions.setServiceRelayPlugin(salonId, ...args),
  checkinReceiptPaymentAction: (...args: Parameters<typeof actions.checkinReceiptPaymentAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.checkinReceiptPaymentAction(salonId, ...args),
  setCampaignPluginAction: (...args: Parameters<typeof actions.setCampaignPluginAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.setCampaignPluginAction(salonId, ...args),
  setPayrollDataPlugin: (...args: Parameters<typeof actions.setPayrollDataPlugin> extends [unknown, ...infer Rest] ? Rest : never) => actions.setPayrollDataPlugin(salonId, ...args),
  cancelMarketBankOrder: (...args: Parameters<typeof actions.cancelMarketBankOrder> extends [unknown, ...infer Rest] ? Rest : never) => actions.cancelMarketBankOrder(salonId, ...args),
  createMarketBankOrder: (...args: Parameters<typeof actions.createMarketBankOrder> extends [unknown, ...infer Rest] ? Rest : never) => actions.createMarketBankOrder(salonId, ...args),
  refreshMarketBankBilling: (...args: Parameters<typeof actions.refreshMarketBankBilling> extends [unknown, ...infer Rest] ? Rest : never) => actions.refreshMarketBankBilling(salonId, ...args),
  bookingDepositBillingAction: (...args: Parameters<typeof actions.bookingDepositBillingAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.bookingDepositBillingAction(salonId, ...args),
  connectBookingStripeAction: (...args: Parameters<typeof actions.connectBookingStripeAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.connectBookingStripeAction(salonId, ...args),
  loadBookingDepositAction: (...args: Parameters<typeof actions.loadBookingDepositAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.loadBookingDepositAction(salonId, ...args),
  saveBookingDepositAction: (...args: Parameters<typeof actions.saveBookingDepositAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.saveBookingDepositAction(salonId, ...args),
  installBookingDepositAction: (...args: Parameters<typeof actions.installBookingDepositAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.installBookingDepositAction(salonId, ...args),
  saveBookingPolicy: (...args: Parameters<typeof actions.saveBookingPolicy> extends [unknown, ...infer Rest] ? Rest : never) => actions.saveBookingPolicy(salonId, ...args),
  bookingPolicyPaymentAction: (...args: Parameters<typeof actions.bookingPolicyPaymentAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.bookingPolicyPaymentAction(salonId, ...args),
  saveBookSms: (...args: Parameters<typeof actions.saveBookSms> extends [unknown, ...infer Rest] ? Rest : never) => actions.saveBookSms(salonId, ...args),
  startCardCheckout: (...args: Parameters<typeof actions.startCardCheckout> extends [unknown, ...infer Rest] ? Rest : never) => actions.startCardCheckout(salonId, ...args),
  refreshCardPurchase: (...args: Parameters<typeof actions.refreshCardPurchase> extends [unknown, ...infer Rest] ? Rest : never) => actions.refreshCardPurchase(salonId, ...args),
  manageCardSubscription: (...args: Parameters<typeof actions.manageCardSubscription> extends [unknown, ...infer Rest] ? Rest : never) => actions.manageCardSubscription(salonId, ...args),
  taxCompanyPaymentAction: (...args: Parameters<typeof actions.taxCompanyPaymentAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.taxCompanyPaymentAction(salonId, ...args),
  marketTrialAction: (...args: Parameters<typeof actions.marketTrialAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.marketTrialAction(salonId, ...args),
  setVietnamesePlugin: (...args: Parameters<typeof actions.setVietnamesePlugin> extends [unknown, ...infer Rest] ? Rest : never) => actions.setVietnamesePlugin(salonId, ...args),
  vietnamesePaymentAction: (...args: Parameters<typeof actions.vietnamesePaymentAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.vietnamesePaymentAction(salonId, ...args),
  beginBookingDepositCheckoutAction: (...args: Parameters<typeof actions.beginBookingDepositCheckoutAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.beginBookingDepositCheckoutAction(salonId, ...args),
  loadCampaignResultsAction: (...args: Parameters<typeof actions.loadCampaignResultsAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.loadCampaignResultsAction(salonId, ...args),
  changeOwnerCampaignAction: (...args: Parameters<typeof actions.changeOwnerCampaignAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.changeOwnerCampaignAction(salonId, ...args),
  loadOwnerCampaignsAction: (...args: Parameters<typeof actions.loadOwnerCampaignsAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.loadOwnerCampaignsAction(salonId, ...args),
  fundSavedCampaignAction: (...args: Parameters<typeof actions.fundSavedCampaignAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.fundSavedCampaignAction(salonId, ...args),
  saveCampaignLimitAction: (...args: Parameters<typeof actions.saveCampaignLimitAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.saveCampaignLimitAction(salonId, ...args),
  loadCampaignPostsAction: (...args: Parameters<typeof actions.loadCampaignPostsAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.loadCampaignPostsAction(salonId, ...args),
  campaignWalletAction: (...args: Parameters<typeof actions.campaignWalletAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.campaignWalletAction(salonId, ...args),
  createCampaignCreativeAction: (...args: Parameters<typeof actions.createCampaignCreativeAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.createCampaignCreativeAction(salonId, ...args),
  buyCampaignCreditsAction: (...args: Parameters<typeof actions.buyCampaignCreditsAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.buyCampaignCreditsAction(salonId, ...args),
  saveCampaignTopupAction: (...args: Parameters<typeof actions.saveCampaignTopupAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.saveCampaignTopupAction(salonId, ...args),
  campaignCardSetupAction: (...args: Parameters<typeof actions.campaignCardSetupAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.campaignCardSetupAction(salonId, ...args),
  campaignPaymentControlAction: (...args: Parameters<typeof actions.campaignPaymentControlAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.campaignPaymentControlAction(salonId, ...args),
  loadCampaignCardAction: (...args: Parameters<typeof actions.loadCampaignCardAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.loadCampaignCardAction(salonId, ...args),
  loadCampaignLedgerAction: (...args: Parameters<typeof actions.loadCampaignLedgerAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.loadCampaignLedgerAction(salonId, ...args),
  saveCampaignRemindersAction: (...args: Parameters<typeof actions.saveCampaignRemindersAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.saveCampaignRemindersAction(salonId, ...args),
  updateTaxSettings: (...args: Parameters<typeof actions.updateTaxSettings> extends [unknown, ...infer Rest] ? Rest : never) => actions.updateTaxSettings(salonId, ...args),
  downloadPayrollData: (...args: Parameters<typeof actions.downloadPayrollData> extends [unknown, ...infer Rest] ? Rest : never) => actions.downloadPayrollData(salonId, ...args),
  createOwnerCampaignAction: (...args: Parameters<typeof actions.createOwnerCampaignAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.createOwnerCampaignAction(salonId, ...args),
  runAgainOwnerCampaignAction: (...args: Parameters<typeof actions.runAgainOwnerCampaignAction> extends [unknown, ...infer Rest] ? Rest : never) => actions.runAgainOwnerCampaignAction(salonId, ...args),
 }), [salonId]);
}
