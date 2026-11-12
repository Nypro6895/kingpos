"use server";
import { taxQaRequest } from "@/lib/tax-workspace-qa";
import { unavailableMarketBankBilling } from "@/lib/market-bank-billing";
import { marketPluginContext } from "@/lib/market-plugins";
import { taxWorkspaceClient } from "@/lib/tax-workspace";
import { marketBankBillingState } from "@/lib/market-bank-billing";
import { marketTaxCheckoutSettings } from "@/lib/market-tax";
import { paymentConfig } from "@/lib/platform-payment";
import { refreshCardPurchase } from "@/app/market/card-payment-actions";
import { setNormalizedWorkspaceContext } from "@/lib/current-context";
import { taxWorkspaceOption } from "@/lib/tax-role";
import { marketServiceClient } from "@/lib/market-payments";
import { taxCompanyPayment, syncTaxCompanySubscription, taxCompanySubscription } from "@/lib/tax-company-subscription";
import { TAX_COMPANY_MONTHLY_CENTS } from "@/types/tax-company";
import { taxOwnerReturnPath } from "@/lib/tax-flow";
import { revalidatePath } from "next/cache";
export async function taxRenewalQuote(expectedSalon: string) {
    try {
        const qa = await taxQaRequest();
        if (qa?.mode === 'owner' && qa.data.salon.id === expectedSalon) {
            const billing = unavailableMarketBankBilling();
            billing.available = true;
            billing.salon_id = expectedSalon;
            billing.catalog = [{ plugin_id: 'tax-company', name: 'Tax Company', publisher: 'Reylumi', price_cents: 790, interval: 'month', published: true, fulfillment_ready: true, commission_bps: 0, version: 1 }];
            return { ok: true as const, billing, tax: { enabled: false, price_behavior: 'exclusive' as const }, legacyPortal: false };
        }
        const { salonId } = await marketPluginContext();
        if (salonId !== expectedSalon)
            throw Error("The selected salon changed. Refresh this page.");
        const service = marketServiceClient();
        const { data: subscription, error: subscriptionError } = await service.from('tax_company_subscriptions').select('stripe_subscription').eq('salon_id', salonId).maybeSingle();
        if (subscriptionError)
            throw Error('Subscription status could not load.');
        if (subscription?.stripe_subscription) {
            const { data: card, error: cardError } = await service.from('market_card_purchases').select('id').eq('salon_id', salonId).eq('subscription_id', subscription.stripe_subscription).maybeSingle();
            if (cardError)
                throw Error('Subscription status could not load.');
            if (!card) {
                const billing = unavailableMarketBankBilling();
                billing.available = true;
                billing.salon_id = salonId;
                billing.catalog = [{ plugin_id: 'tax-company', name: 'Tax Company', publisher: 'Reylumi', price_cents: TAX_COMPANY_MONTHLY_CENTS, interval: 'month', published: true, fulfillment_ready: true, commission_bps: 0, version: 0 }];
                return { ok: true as const, billing, tax: { enabled: false, price_behavior: 'exclusive' as const }, legacyPortal: true };
            }
        }
        const [billing, tax, config] = await Promise.all([marketBankBillingState(salonId), marketTaxCheckoutSettings(), paymentConfig()]);
        if (!billing.available || !config.enabled || config.mode !== "live" || !config.webhookSecret)
            throw Error("Card payment is temporarily unavailable. Try again later.");
        return { ok: true as const, billing, tax, legacyPortal: false };
    }
    catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : "Pricing could not load." };
    }
}
export async function createTaxInvitation(expectedSalon?: string) {
    try {
        const qa = await taxQaRequest();
        if (qa?.mode === 'owner' && qa.data.salon.id === expectedSalon)
            return { ok: true as const, token: 'a'.repeat(64), expiresAt: new Date(Date.now() + 604800000).toISOString() };
        const { client, salonId } = await marketPluginContext();
        if (!expectedSalon || salonId !== expectedSalon)
            throw Error("The selected salon changed. Refresh this page.");
        const { data, error } = await client.rpc("tax_create_invitation", { p_salon: salonId });
        if (error)
            throw Error(error.message);
        return { ok: true as const, token: String(data.token), expiresAt: String(data.expires_at) };
    }
    catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : "Invitation could not be created." };
    }
}
export async function revokeTaxInvitation(expectedSalon?: string) {
    try {
        const qa = await taxQaRequest();
        if (qa?.mode === 'owner' && qa.data.salon.id === expectedSalon)
            return { ok: true as const };
        const { client, salonId } = await marketPluginContext();
        if (!expectedSalon || salonId !== expectedSalon)
            throw Error("The selected salon changed. Refresh this page.");
        const { error } = await client.rpc("tax_revoke_invitation", { p_salon: salonId });
        if (error)
            throw Error(error.message);
        return { ok: true as const };
    }
    catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : "Invitation could not be revoked." };
    }
}
export async function acceptTaxInvitation(token: string) {
    try {
        const { client } = await taxWorkspaceClient();
        const { data, error } = await client.rpc("tax_accept_invitation", { p_token: token });
        if (error)
            throw Error(error.message);
        await setNormalizedWorkspaceContext(taxWorkspaceOption());
        revalidatePath("/tax", "layout");
        return { ok: true as const, salonId: String(data) };
    }
    catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : "Connection could not be completed." };
    }
}
export async function taxLegacyRenewal(expectedSalon: string, returnPath: string) {
    try {
        const { salonId, userId } = await marketPluginContext();
        const target = taxOwnerReturnPath(returnPath, salonId);
        if (salonId !== expectedSalon || !target)
            throw Error('The selected salon changed. Refresh before paying.');
        return { ok: true as const, url: await taxCompanyPayment(salonId, userId, true, target) };
    }
    catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : 'Billing could not open.' };
    }
}
export async function refreshTaxRenewal(expectedSalon: string) {
    const modern = await refreshCardPurchase('tax-company', expectedSalon);
    if (modern.active)
        return modern;
    try {
        const { salonId } = await marketPluginContext();
        if (salonId !== expectedSalon)
            return modern;
        const client = marketServiceClient();
        const { data: row, error } = await client.from('tax_company_subscriptions').select('stripe_subscription').eq('salon_id', salonId).maybeSingle();
        if (error || !row?.stripe_subscription)
            return modern;
        const { data: card, error: cardError } = await client.from('market_card_purchases').select('id').eq('subscription_id', row.stripe_subscription).maybeSingle();
        if (cardError || card)
            return modern;
        await syncTaxCompanySubscription(row.stripe_subscription);
        return { active: (await taxCompanySubscription(salonId)).active, salonId, message: 'Subscription checked.' };
    }
    catch {
        return modern;
    }
}
