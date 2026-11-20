import {checkWriterMarketState} from "@/lib/check-writer-market";
import "server-only";
import {bookSmsState} from "@/lib/booksms";
import { taxCompanySubscription } from "@/lib/tax-company-subscription";
import {paymentConfig} from "@/lib/platform-payment";
import {marketTaxCheckoutSettings} from "@/lib/market-tax";
import { bookingDepositState } from "@/lib/booking-deposit";
import { serviceRelayInstalled } from "@/app/service-relay/actions";
import { bookingPolicySubscription } from "@/lib/booking-policy-subscription";
import { marketInstallationCounts } from "@/lib/market-installation-counts";
import { checkinReceiptSubscription } from "@/lib/checkin-receipt-subscription";
import { campaignWalletAction } from "@/app/campaigns/credit-actions";
import { payrollDataPluginInstalled } from "@/lib/market-plugins";
import { vietnamesePluginState } from "@/lib/vietnamese-plugin";
import { EMPTY_VIETNAMESE_PLUGIN } from "@/types/vietnamese-plugin";
import { marketPaymentSettings, marketPaymentReady } from "@/lib/market-payments";
import { marketBankBillingState } from "@/lib/market-bank-billing";

import type { CurrentBusinessContext } from "@/lib/current-context";
import type { MarketExperienceData } from "@/types/market-experience";
import { getExperienceContext } from "@/lib/experience-context";

export async function loadMarketExperienceData(context: CurrentBusinessContext, query: { bookingStripe?: string; payment?: string } = {}): Promise<MarketExperienceData> {
  // These are independent reads. Keep their error precedence deterministic while
  // avoiding a serial chain of optional subscription/settings requests.
  const [installationCounts, bankBillingState, relayInstalled, payroll, campaign, language,
    checkinReceipt, bookingPolicy, bookingDeposit, cardConfig, automaticTax, taxCompany, booksms, checkWriter] = await Promise.all([
    marketInstallationCounts(),
    marketBankBillingState(context.currentSalon?.id ?? null),
    context.currentSalon ? serviceRelayInstalled(context.currentSalon.id).catch(() => false) : Promise.resolve(false),
    payrollDataPluginInstalled().then(installed => ({ installed, error: "" })).catch(cause => ({ installed: false, error: cause instanceof Error ? cause.message : "Market features could not be loaded." })),
    campaignWalletAction().catch(() => null),
    (async () => {
      let vietnamese = EMPTY_VIETNAMESE_PLUGIN;
      try {
        vietnamese = await vietnamesePluginState(context.currentSalon?.id ?? null);
        const settings = await marketPaymentSettings();
        return { vietnamese, published: settings.vietnamese_published, enabled: settings.enabled, error: "" };
      } catch (cause) {
        return { vietnamese, published: true, enabled: false, error: cause instanceof Error ? cause.message : "Vietnamese plugin could not load." };
      }
    })(),
    context.currentSalon ? checkinReceiptSubscription(context.currentSalon.id).catch(() => ({ active: false, subscribed: false })) : Promise.resolve({ active: false, subscribed: false }),
    context.currentSalon ? bookingPolicySubscription(context.currentSalon.id).catch(() => undefined) : Promise.resolve(undefined),
    context.currentSalon ? bookingDepositState(context.currentSalon.id).catch(() => undefined) : Promise.resolve(undefined),
    paymentConfig().catch(() => null),
    marketTaxCheckoutSettings().catch(() => undefined),
    context.currentSalon ? taxCompanySubscription(context.currentSalon.id).catch(() => ({ active: false, subscribed: false })) : Promise.resolve({ active: false, subscribed: false }),
    bookSmsState().catch(() => undefined),
    checkWriterMarketState(),
  ]);
  let error = query.bookingStripe === "failed" ? "Stripe connection could not be completed. Check that your salon account can receive payments and pays its own processing fees, then try connecting again." : "";
  if (payroll.error) error = payroll.error;
  error ||= language.error;
  const paymentsAvailable = bankBillingState.settings.version === 0 && language.enabled && marketPaymentReady();
  return { checkWriter, automaticTax, cardReady: Boolean(cardConfig?.enabled && cardConfig.mode === "live" && cardConfig.webhookSecret), booksms, experienceScope: getExperienceContext(context).scope, taxCompany, bankBillingState, paymentsAvailable, paymentReturn: query.payment === "received" || query.payment === "cancelled" ? query.payment : undefined, serviceRelayInstalled: relayInstalled, bookingDeposit, bookingPolicy, installationCounts, checkinReceipt, vietnameseState: language.vietnamese, vietnamesePublished: language.published, campaignInstalled: campaign?.installed ?? false, payrollDownloadInstalled: payroll.installed, pluginLoadError: error };
}
