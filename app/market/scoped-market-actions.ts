"use server";
import { unavailableMarketBankBilling } from "@/lib/market-bank-billing";
import { withMarketTarget } from "@/lib/market-target-context";
import { setServiceRelayPlugin as domainsetServiceRelayPlugin } from "@/app/service-relay/actions";
export async function setServiceRelayPlugin(salonId: string | undefined, ...args: Parameters<typeof domainsetServiceRelayPlugin>) {
 try { return await withMarketTarget(salonId, () => domainsetServiceRelayPlugin(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { checkinReceiptPaymentAction as domaincheckinReceiptPaymentAction } from "@/app/market/checkin-receipt-actions";
export async function checkinReceiptPaymentAction(salonId: string | undefined, ...args: Parameters<typeof domaincheckinReceiptPaymentAction>) {
 try { return await withMarketTarget(salonId, () => domaincheckinReceiptPaymentAction(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { setCampaignPluginAction as domainsetCampaignPluginAction } from "@/app/campaigns/credit-actions";
export async function setCampaignPluginAction(salonId: string | undefined, ...args: Parameters<typeof domainsetCampaignPluginAction>) {
 try { return await withMarketTarget(salonId, () => domainsetCampaignPluginAction(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { setPayrollDataPlugin as domainsetPayrollDataPlugin } from "@/app/market/plugin-actions";
export async function setPayrollDataPlugin(salonId: string | undefined, ...args: Parameters<typeof domainsetPayrollDataPlugin>) {
 try { return await withMarketTarget(salonId, () => domainsetPayrollDataPlugin(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { cancelMarketBankOrder as domaincancelMarketBankOrder } from "@/app/market/bank-payment-actions";
export async function cancelMarketBankOrder(salonId: string | undefined, ...args: Parameters<typeof domaincancelMarketBankOrder>) {
 try { return await withMarketTarget(salonId, () => domaincancelMarketBankOrder(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { createMarketBankOrder as domaincreateMarketBankOrder } from "@/app/market/bank-payment-actions";
export async function createMarketBankOrder(salonId: string | undefined, ...args: Parameters<typeof domaincreateMarketBankOrder>) {
 try { return await withMarketTarget(salonId, () => domaincreateMarketBankOrder(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { refreshMarketBankBilling as domainrefreshMarketBankBilling } from "@/app/market/bank-payment-actions";
export async function refreshMarketBankBilling(salonId: string | undefined, ...args: Parameters<typeof domainrefreshMarketBankBilling>) {
 try { return await withMarketTarget(salonId, () => domainrefreshMarketBankBilling(...args)); }
 catch (cause) { return unavailableMarketBankBilling("owner_required", cause instanceof Error ? cause.message : "Market could not be updated. Please retry."); }
}
import { bookingDepositBillingAction as domainbookingDepositBillingAction } from "@/app/market/booking-deposit-actions";
export async function bookingDepositBillingAction(salonId: string | undefined, ...args: Parameters<typeof domainbookingDepositBillingAction>) {
 try { return await withMarketTarget(salonId, () => domainbookingDepositBillingAction(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { connectBookingStripeAction as domainconnectBookingStripeAction } from "@/app/market/booking-deposit-actions";
export async function connectBookingStripeAction(salonId: string | undefined, ...args: Parameters<typeof domainconnectBookingStripeAction>) {
 try { return await withMarketTarget(salonId, () => domainconnectBookingStripeAction(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { loadBookingDepositAction as domainloadBookingDepositAction } from "@/app/market/booking-deposit-actions";
export async function loadBookingDepositAction(salonId: string | undefined, ...args: Parameters<typeof domainloadBookingDepositAction>) {
 try { return await withMarketTarget(salonId, () => domainloadBookingDepositAction(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { saveBookingDepositAction as domainsaveBookingDepositAction } from "@/app/market/booking-deposit-actions";
export async function saveBookingDepositAction(salonId: string | undefined, ...args: Parameters<typeof domainsaveBookingDepositAction>) {
 try { return await withMarketTarget(salonId, () => domainsaveBookingDepositAction(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { installBookingDepositAction as domaininstallBookingDepositAction } from "@/app/market/booking-deposit-actions";
export async function installBookingDepositAction(salonId: string | undefined, ...args: Parameters<typeof domaininstallBookingDepositAction>) {
 try { return await withMarketTarget(salonId, () => domaininstallBookingDepositAction(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { saveBookingPolicy as domainsaveBookingPolicy } from "@/app/market/booking-policy-actions";
export async function saveBookingPolicy(salonId: string | undefined, ...args: Parameters<typeof domainsaveBookingPolicy>) {
 try { return await withMarketTarget(salonId, () => domainsaveBookingPolicy(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { bookingPolicyPaymentAction as domainbookingPolicyPaymentAction } from "@/app/market/booking-policy-actions";
export async function bookingPolicyPaymentAction(salonId: string | undefined, ...args: Parameters<typeof domainbookingPolicyPaymentAction>) {
 try { return await withMarketTarget(salonId, () => domainbookingPolicyPaymentAction(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { saveBookSms as domainsaveBookSms } from "@/app/market/booksms-actions";
export async function saveBookSms(salonId: string | undefined, ...args: Parameters<typeof domainsaveBookSms>) {
 try { return await withMarketTarget(salonId, () => domainsaveBookSms(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { startCardCheckout as domainstartCardCheckout } from "@/app/market/card-payment-actions";
export async function startCardCheckout(salonId: string | undefined, ...args: Parameters<typeof domainstartCardCheckout>) {
 try { return await withMarketTarget(salonId, () => domainstartCardCheckout(...args)); }
 catch (cause) { return { message: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { refreshCardPurchase as domainrefreshCardPurchase } from "@/app/market/card-payment-actions";
export async function refreshCardPurchase(salonId: string | undefined, ...args: Parameters<typeof domainrefreshCardPurchase>): ReturnType<typeof domainrefreshCardPurchase> {
 try { return await withMarketTarget(salonId, () => domainrefreshCardPurchase(...args)); }
 catch (cause) { return { active: false, message: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { manageCardSubscription as domainmanageCardSubscription } from "@/app/market/card-payment-actions";
export async function manageCardSubscription(salonId: string | undefined, ...args: Parameters<typeof domainmanageCardSubscription>) {
 try { return await withMarketTarget(salonId, () => domainmanageCardSubscription(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { taxCompanyPaymentAction as domaintaxCompanyPaymentAction } from "@/app/market/tax-company-actions";
export async function taxCompanyPaymentAction(salonId: string | undefined, ...args: Parameters<typeof domaintaxCompanyPaymentAction>) {
 try { return await withMarketTarget(salonId, () => domaintaxCompanyPaymentAction(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { marketTrialAction as domainmarketTrialAction } from "@/app/market/trial-actions";
export async function marketTrialAction(salonId: string | undefined, ...args: Parameters<typeof domainmarketTrialAction>) {
 try { return await withMarketTarget(salonId, () => domainmarketTrialAction(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { setVietnamesePlugin as domainsetVietnamesePlugin } from "@/app/market/vietnamese-actions";
export async function setVietnamesePlugin(salonId: string | undefined, ...args: Parameters<typeof domainsetVietnamesePlugin>) {
 try { return await withMarketTarget(salonId, () => domainsetVietnamesePlugin(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { vietnamesePaymentAction as domainvietnamesePaymentAction } from "@/app/market/vietnamese-actions";
export async function vietnamesePaymentAction(salonId: string | undefined, ...args: Parameters<typeof domainvietnamesePaymentAction>) {
 try { return await withMarketTarget(salonId, () => domainvietnamesePaymentAction(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}
import { beginBookingDepositCheckoutAction as domainbeginBookingDepositCheckoutAction } from "@/app/market/booking-deposit-purchase-actions";
export async function beginBookingDepositCheckoutAction(salonId: string | undefined, ...args: Parameters<typeof domainbeginBookingDepositCheckoutAction>) {
 try { return await withMarketTarget(salonId, () => domainbeginBookingDepositCheckoutAction(...args)); }
 catch (cause) { return { error: cause instanceof Error ? cause.message : "Market could not be updated. Please retry." }; }
}

import {loadCampaignResultsAction as domainloadCampaignResultsAction} from "@/app/campaigns/actions";
export async function loadCampaignResultsAction(salonId:string|undefined,...args:Parameters<typeof domainloadCampaignResultsAction>){return withMarketTarget(salonId,()=>domainloadCampaignResultsAction(...args));}

import {changeOwnerCampaignAction as domainchangeOwnerCampaignAction} from "@/app/campaigns/actions";
export async function changeOwnerCampaignAction(salonId:string|undefined,...args:Parameters<typeof domainchangeOwnerCampaignAction>){return withMarketTarget(salonId,()=>domainchangeOwnerCampaignAction(...args));}

import {loadOwnerCampaignsAction as domainloadOwnerCampaignsAction} from "@/app/campaigns/actions";
export async function loadOwnerCampaignsAction(salonId:string|undefined,...args:Parameters<typeof domainloadOwnerCampaignsAction>){return withMarketTarget(salonId,()=>domainloadOwnerCampaignsAction(...args));}

import {fundSavedCampaignAction as domainfundSavedCampaignAction} from "@/app/campaigns/actions";
export async function fundSavedCampaignAction(salonId:string|undefined,...args:Parameters<typeof domainfundSavedCampaignAction>){return withMarketTarget(salonId,()=>domainfundSavedCampaignAction(...args));}

import {saveCampaignLimitAction as domainsaveCampaignLimitAction} from "@/app/campaigns/actions";
export async function saveCampaignLimitAction(salonId:string|undefined,...args:Parameters<typeof domainsaveCampaignLimitAction>){return withMarketTarget(salonId,()=>domainsaveCampaignLimitAction(...args));}

import {loadCampaignPostsAction as domainloadCampaignPostsAction} from "@/app/campaigns/actions";
export async function loadCampaignPostsAction(salonId:string|undefined,...args:Parameters<typeof domainloadCampaignPostsAction>){return withMarketTarget(salonId,()=>domainloadCampaignPostsAction(...args));}

import {campaignWalletAction as domaincampaignWalletAction} from "@/app/campaigns/credit-actions";
export async function campaignWalletAction(salonId:string|undefined,...args:Parameters<typeof domaincampaignWalletAction>){return withMarketTarget(salonId,()=>domaincampaignWalletAction(...args));}

import {createCampaignCreativeAction as domaincreateCampaignCreativeAction} from "@/app/campaigns/creative-actions";
export async function createCampaignCreativeAction(salonId:string|undefined,...args:Parameters<typeof domaincreateCampaignCreativeAction>){return withMarketTarget(salonId,()=>domaincreateCampaignCreativeAction(...args));}

import {buyCampaignCreditsAction as domainbuyCampaignCreditsAction} from "@/app/campaigns/credit-actions";
export async function buyCampaignCreditsAction(salonId:string|undefined,...args:Parameters<typeof domainbuyCampaignCreditsAction>){return withMarketTarget(salonId,()=>domainbuyCampaignCreditsAction(...args));}

import {saveCampaignTopupAction as domainsaveCampaignTopupAction} from "@/app/campaigns/credit-actions";
export async function saveCampaignTopupAction(salonId:string|undefined,...args:Parameters<typeof domainsaveCampaignTopupAction>){return withMarketTarget(salonId,()=>domainsaveCampaignTopupAction(...args));}

import {campaignCardSetupAction as domaincampaignCardSetupAction} from "@/app/campaigns/credit-actions";
export async function campaignCardSetupAction(salonId:string|undefined,...args:Parameters<typeof domaincampaignCardSetupAction>){return withMarketTarget(salonId,()=>domaincampaignCardSetupAction(...args));}

import {campaignPaymentControlAction as domaincampaignPaymentControlAction} from "@/app/campaigns/credit-actions";
export async function campaignPaymentControlAction(salonId:string|undefined,...args:Parameters<typeof domaincampaignPaymentControlAction>){return withMarketTarget(salonId,()=>domaincampaignPaymentControlAction(...args));}

import {loadCampaignCardAction as domainloadCampaignCardAction} from "@/app/campaigns/credit-actions";
export async function loadCampaignCardAction(salonId:string|undefined,...args:Parameters<typeof domainloadCampaignCardAction>){return withMarketTarget(salonId,()=>domainloadCampaignCardAction(...args));}

import {loadCampaignLedgerAction as domainloadCampaignLedgerAction} from "@/app/campaigns/credit-actions";
export async function loadCampaignLedgerAction(salonId:string|undefined,...args:Parameters<typeof domainloadCampaignLedgerAction>){return withMarketTarget(salonId,()=>domainloadCampaignLedgerAction(...args));}

import {saveCampaignRemindersAction as domainsaveCampaignRemindersAction} from "@/app/campaigns/credit-actions";
export async function saveCampaignRemindersAction(salonId:string|undefined,...args:Parameters<typeof domainsaveCampaignRemindersAction>){return withMarketTarget(salonId,()=>domainsaveCampaignRemindersAction(...args));}

import {updateTaxSettings as domainupdateTaxSettings} from "@/app/tax-company/actions";
export async function updateTaxSettings(salonId:string|undefined,...args:Parameters<typeof domainupdateTaxSettings>){return withMarketTarget(salonId,()=>domainupdateTaxSettings(...args));}

import {downloadPayrollData as domaindownloadPayrollData} from "@/app/payroll/data-download-actions";
export async function downloadPayrollData(salonId:string|undefined,...args:Parameters<typeof domaindownloadPayrollData>){return withMarketTarget(salonId,()=>domaindownloadPayrollData(...args));}

import {createOwnerCampaignAction as domaincreateOwnerCampaignAction} from "@/app/campaigns/actions";
export async function createOwnerCampaignAction(salonId:string|undefined,...args:Parameters<typeof domaincreateOwnerCampaignAction>){return withMarketTarget(salonId,()=>domaincreateOwnerCampaignAction(...args));}

import {runAgainOwnerCampaignAction as domainrunAgainOwnerCampaignAction} from "@/app/campaigns/actions";
export async function runAgainOwnerCampaignAction(salonId:string|undefined,...args:Parameters<typeof domainrunAgainOwnerCampaignAction>){return withMarketTarget(salonId,()=>domainrunAgainOwnerCampaignAction(...args));}

import { loadOwnerCampaignAction as domainloadOwnerCampaignAction } from "@/app/campaigns/actions";
export async function loadOwnerCampaignAction(salonId: string | undefined, ...args: Parameters<typeof domainloadOwnerCampaignAction>) { try { return await withMarketTarget(salonId, () => domainloadOwnerCampaignAction(...args)); } catch(cause) { throw cause; } }

import { loadCampaignReportAction as domainloadCampaignReportAction } from "@/app/campaigns/actions";
export async function loadCampaignReportAction(salonId: string | undefined, ...args: Parameters<typeof domainloadCampaignReportAction>) { try { return await withMarketTarget(salonId, () => domainloadCampaignReportAction(...args)); } catch(cause) { throw cause; } }
