import "server-only";
import { createClient } from "@supabase/supabase-js";
import { platformRpc, PlatformError } from "./server";
import { checkoutForm, providerRedirect, testPaymentConfig } from "./stripe-test";
import { readOrganization, readSeller, readCheckoutVersion, readSavedQuote, quoteMatchesStoredOrder, providerSellerMatches, checkoutMatches, readRefundQuote, refundMatchesStoredOrder, refundChargeMatches, readProviderRefund } from "./commerce-read-model";

async function currentSeller() {
  const organization = readOrganization(await platformRpc<unknown>("workspace"));
  if (!organization) throw new PlatformError("Reload your developer organization before managing test payments.");
  const seller = readSeller(await platformRpc<unknown>("seller"), organization);
  if (!seller) throw new PlatformError("Seller details could not be verified. Reload and reconcile before continuing.", "unknown");
  return seller;
}
function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", key = process.env.MARKET_PLATFORM_TEST_SERVICE_ROLE_KEY;
  if (!/^http:\/\/(localhost|127\.0\.0\.1):[0-9]{2,5}$/.test(url) || !key) throw new PlatformError("Test commerce requires an isolated local Supabase database. Production storage is not accepted.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function serviceRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service().rpc(`market_platform_${name}`, args);
  if (error || data !== true) throw new PlatformError("Provider state needs reconciliation. Reload before retrying; do not create a second purchase.", "unknown");
}
// Intentionally separate test credentials: never fall back to first-party live billing.
async function stripe(path: string, form?: URLSearchParams, idempotency?: string, account?: string): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const config = testPaymentConfig();
  const result = await fetch(`https://api.stripe.com/v1/${path}`, { method: form ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(15000), headers: {
    Authorization: `Bearer ${config.key}`, "Stripe-Version": "2025-02-24.acacia", ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    ...(idempotency ? { "Idempotency-Key": idempotency } : {}), ...(account ? { "Stripe-Account": account } : {}),
  }, body: form?.toString() });
  if (!result.ok) throw new PlatformError("Stripe test request could not be completed. Retry or check the test configuration.");
  return result.json();
}
async function assertPlatform() {
  const expected = testPaymentConfig().accountId;
  const account = await stripe("account");
  if (account.id !== expected) throw new PlatformError("Stripe test platform account does not match configuration.");
}
export async function startSellerOnboarding() {
  const seller = await currentSeller();
  if (!seller.testEnabled) throw new PlatformError("Seller onboarding awaits approved test commerce configuration.");
  service(); await assertPlatform();
  let accountId = seller.account_id;
  if (!accountId) {
    if (Date.now() - Date.parse(seller.updated_at) > 23 * 3600000) throw new PlatformError("An interrupted onboarding request needs reconciliation before creating a provider account.");
    const account = await stripe("accounts", new URLSearchParams({ "controller[fees][payer]": "application", "controller[losses][payments]": "application", "controller[stripe_dashboard][type]": "express", "capabilities[transfers][requested]": "true", "capabilities[card_payments][requested]": "true", "metadata[market_platform_organization]": seller.organization_id }), `market-seller-${seller.organization_id}`);
    if (!providerSellerMatches(account, seller.organization_id)) throw new PlatformError("Invalid test account response. Reconcile before continuing.", "unknown");
    accountId = account.id;
    await serviceRpc("seller_apply", { p_organization: seller.organization_id, p_account: accountId, p_charges: account.charges_enabled === true, p_payouts: account.payouts_enabled === true, p_details: account.details_submitted === true });
  } else {
    const account = await stripe(`accounts/${encodeURIComponent(accountId)}`);
    if (!providerSellerMatches(account, seller.organization_id, accountId)) throw new PlatformError("Seller identity mismatch.", "unknown");
  }
  const origin = testPaymentConfig().origin;
  const link = await stripe("account_links", new URLSearchParams({ account: accountId!, type: "account_onboarding", "collection_options[fields]": "eventually_due", return_url: `${origin}/developer-platform?onboarding=returned`, refresh_url: `${origin}/developer-platform?onboarding=refresh` }));
  return providerRedirect(link.url, "onboarding");
}
export async function refreshSellerStatus() {
  const seller = await currentSeller();
  if (!seller.testEnabled || !seller.account_id) throw new PlatformError("Start test onboarding first.");
  service(); await assertPlatform();
  const account = await stripe(`accounts/${encodeURIComponent(seller.account_id)}`);
  if (!providerSellerMatches(account, seller.organization_id, seller.account_id)) throw new PlatformError("Seller identity mismatch.", "unknown");
  await serviceRpc("seller_apply", { p_organization: seller.organization_id, p_account: account.id, p_charges: account.charges_enabled === true, p_payouts: account.payouts_enabled === true, p_details: account.details_submitted === true });
}
export async function startTestCheckout(salon: string, version: string, sha256: string) {
  const approved = readCheckoutVersion(await platformRpc<unknown>("owner_workspace", { p_salon: salon }), salon, version, sha256);
  if (!approved) throw new PlatformError("Reload the exact approved version before continuing to test Checkout.");
  const quote = readSavedQuote(await platformRpc<unknown>("quote", { p_salon: salon, p_version: version, p_sha256: sha256 }), salon, version, approved);
  if (!quote || !quoteMatchesStoredOrder(quote, await platformRpc<unknown>("commerce_workspace"))) throw new PlatformError("Purchase details could not be verified. Reload and reconcile before continuing.", "unknown");
  if (quote.state === "paid") throw new PlatformError("This version is already paid. Approve its permissions to install it.");
  service(); await assertPlatform();
  if (!quote.checkout_id) {
    if (Date.now() - Date.parse(quote.created_at) > 23 * 3600000) throw new PlatformError("This interrupted purchase needs reconciliation before creating another checkout.");
    const session = await stripe("checkout/sessions", checkoutForm(quote, testPaymentConfig()), `market-order-${quote.id}`);
    if (!checkoutMatches(session, quote)) throw new PlatformError("Test checkout does not match the saved purchase. Reconcile before continuing.", "unknown");
    await serviceRpc("checkout_apply", { p_order: quote.id, p_checkout: session.id });
    return providerRedirect(session.url, "checkout");
  }
  const session = await stripe(`checkout/sessions/${encodeURIComponent(quote.checkout_id)}`);
  if (!checkoutMatches(session, quote, quote.checkout_id)) throw new PlatformError("This checkout does not match, is complete or expired. Payment reconciliation may be required.", "unknown");
  return providerRedirect(session.url, "checkout");
}
export async function requestFullTestRefund(order: string) {
  const quote = readRefundQuote(await platformRpc<unknown>("refund_quote", { p_order: order }), order);
  if (!quote || !refundMatchesStoredOrder(quote, await platformRpc<unknown>("finance_workspace")))
    throw new PlatformError("Refund request could not be verified. Reload and reconcile before continuing.", "unknown");
  service(); await assertPlatform();
  const charge = await stripe(`charges/${encodeURIComponent(quote.charge_id)}`);
  if (!refundChargeMatches(charge, quote)) throw new PlatformError("Refund charge does not match the saved test purchase.", "unknown");
  const intent = quote.refund_intent;
  let response: unknown;
  if (intent.refund_id) {
    response = await stripe(`refunds/${encodeURIComponent(intent.refund_id)}`);
  } else {
    const listed = await stripe(`refunds?charge=${encodeURIComponent(quote.charge_id)}&limit=100`);
    if (!Array.isArray(listed.data) || listed.has_more !== false || listed.data.length > 100)
      throw new PlatformError("Refund history needs paginated reconciliation. No second refund was requested.", "unknown");
    if (listed.data.length) {
      // Conflicting/partial/unattributed refunds are an explicit reconciliation
      // boundary. Never guess a remaining amount or silently start a new refund.
      if (listed.data.length !== 1 || !readProviderRefund(listed.data[0], quote))
        throw new PlatformError("Existing refunds need reconciliation. No second refund was requested.", "unknown");
      response = listed.data[0];
    } else {
      if (charge.amount_refunded !== 0 || intent.status !== "requested" || Date.now() - Date.parse(intent.created_at) > 23 * 3600000)
        throw new PlatformError("This interrupted refund needs reconciliation before another provider request.", "unknown");
      try {
        response = await stripe("refunds", new URLSearchParams({ charge: quote.charge_id, amount: String(quote.amount_cents), reverse_transfer: "true", refund_application_fee: "true", "metadata[market_platform_order]": quote.id }), `market-full-refund-${quote.id}`);
      } catch {
        throw new PlatformError("The refund request may have reached the provider. Reload and reconcile before retrying.", "unknown");
      }
    }
  }
  const refund = readProviderRefund(response, quote, intent.refund_id ?? undefined);
  if (!refund) throw new PlatformError("Refund response needs reconciliation.", "unknown");
  await serviceRpc("refund_observation_apply", { p_intent: intent.id, p_refund: refund.id, p_status: refund.status });
  // Only authoritative charge.refunded reconciliation may change entitlement.
  return refund.status;
}

export async function reconcileTestEvent(eventId: string, connectedAccount?: string) {
  if (!/^evt_[A-Za-z0-9]+$/.test(eventId)) throw new PlatformError("Invalid event.");
  if (connectedAccount && !/^acct_[A-Za-z0-9]+$/.test(connectedAccount)) throw new PlatformError("Invalid connected account.");
  service(); await assertPlatform();
  const event = await stripe(`events/${eventId}`, undefined, undefined, connectedAccount);
  if (event.livemode !== false || event.id !== eventId) throw new PlatformError("Test event required.");
  if (connectedAccount && event.account !== connectedAccount) throw new PlatformError("Connected event account mismatch.");
  const obj = event.data?.object;
  if (event.type === "account.updated") {
    const account = await stripe(`accounts/${encodeURIComponent(obj.id)}`);
    const organization = account.metadata?.market_platform_organization;
    if (!organization) return;
    await serviceRpc("seller_apply", { p_organization: organization, p_account: account.id, p_charges: account.charges_enabled === true, p_payouts: account.payouts_enabled === true, p_details: account.details_submitted === true });return;
  }
  if (event.type.startsWith("payout.") && /^acct_[A-Za-z0-9]+$/.test(event.account ?? "")) {
    const payout = await stripe(`payouts/${encodeURIComponent(obj.id)}`, undefined, undefined, event.account);
    if (payout.livemode !== false) throw new PlatformError("Test payout required.");
    await serviceRpc("payout_apply", { p_account: event.account, p_id: payout.id, p_amount: payout.amount, p_currency: payout.currency, p_status: payout.status, p_observed: new Date(event.created * 1000).toISOString() });return;
  }
  // Platform destination charges only; connected-account payment events cannot grant entitlements.
  if (event.account) return;
  let sessionId: string | undefined;
  if (event.type.startsWith("checkout.session.")) sessionId = obj.id;
  else if (event.type.startsWith("charge.")) {
    const charge = await stripe(`charges/${encodeURIComponent(obj.charge ?? obj.id)}`);
    if (!charge.payment_intent) return;
    const sessions = await stripe(`checkout/sessions?payment_intent=${encodeURIComponent(charge.payment_intent)}&limit=2`);
    if (sessions.data?.length !== 1) throw new PlatformError("Purchase session needs reconciliation.");
    sessionId = sessions.data[0].id;
  } else if (event.type === "payment_intent.succeeded") {
    const sessions = await stripe(`checkout/sessions?payment_intent=${encodeURIComponent(obj.id)}&limit=2`);
    if (sessions.data?.length !== 1) throw new PlatformError("Purchase session needs reconciliation.");sessionId = sessions.data[0].id;
  }
  if (!sessionId || !/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) return;
  const session = await stripe(`checkout/sessions/${sessionId}?expand[]=payment_intent.latest_charge`);
  const orderId = session.metadata?.market_platform_order;
  if (!orderId) return;
  const intent = session.payment_intent, charge = intent?.latest_charge;
  if (session.livemode !== false || session.currency !== "usd" || session.mode !== "payment" || session.client_reference_id !== orderId || intent?.metadata?.market_platform_order !== orderId) throw new PlatformError("Payment identity mismatch.");
  if (session.payment_status !== "paid" || intent.status !== "succeeded" || charge?.paid !== true) return;
  if (intent.livemode !== false || charge.livemode !== false || charge.currency !== "usd" || intent.currency !== "usd" || session.amount_total !== intent.amount_received || charge.amount !== session.amount_total) throw new PlatformError("Payment amount mismatch.");
  let disputed = charge.disputed === true;
  if (disputed) {
    const disputes = await stripe(`disputes?charge=${encodeURIComponent(charge.id)}&limit=10`);
    if (!Array.isArray(disputes.data) || disputes.has_more) throw new PlatformError("Dispute state needs reconciliation.");
    disputed = disputes.data.some((d: { status: string }) => d.status !== "won");
  }
  await serviceRpc("payment_apply", { p_event: event.id, p_kind: event.type, p_order: orderId, p_checkout: session.id, p_charge: charge.id, p_amount: session.amount_total, p_fee: intent.application_fee_amount, p_account: intent.transfer_data?.destination, p_refunded: charge.amount_refunded, p_disputed: disputed, p_transfer: typeof charge.transfer === "string" ? charge.transfer : null, p_observed: new Date(event.created * 1000).toISOString() });
  if (charge.amount_refunded > 0) {
    const refunds = await stripe(`refunds?charge=${encodeURIComponent(charge.id)}&limit=100`);
    if (!Array.isArray(refunds.data) || refunds.has_more !== false || refunds.data.length > 100) throw new PlatformError("Refund request observations need paginated reconciliation.", "unknown");
    for (const value of refunds.data) {
      if (value?.metadata?.market_platform_order !== orderId || value?.amount !== charge.amount) continue; // Partial/unattributed refunds require separate support review.
      const refund = readProviderRefund(value, { id: orderId, charge_id: charge.id, amount_cents: charge.amount });
      if (!refund) throw new PlatformError("Refund request observation does not match the verified charge.", "unknown");
      await serviceRpc("refund_observation_for_order_apply", { p_order: orderId, p_charge: charge.id, p_amount: charge.amount, p_refund: refund.id, p_status: refund.status });
    }
  }
  if (charge.balance_transaction) await observeChargeBalances(orderId, charge, intent.transfer_data?.destination);
}

// Follow only objects linked from the verified charge. No arbitrary provider
// transaction IDs from browser forms or webhook payloads enter the ledger.
async function observeChargeBalances(order: string, charge: Record<string, any>, destination: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const account = testPaymentConfig().accountId;
  const objectId = (value: unknown) => typeof value === "string" ? value : (value as {id?:string} | null)?.id;
  async function observe(source: string, value: unknown) {
    const id = objectId(value);if (!id) return;
    if (!/^txn_[A-Za-z0-9]+$/.test(id)) throw new PlatformError("Invalid balance transaction reference.");
    const balance = await stripe(`balance_transactions/${id}`);
    if (balance.id !== id || objectId(balance.source) !== source || balance.currency !== "usd" || ![balance.amount,balance.fee,balance.net,balance.created].every(Number.isSafeInteger) || balance.amount-balance.fee!==balance.net) throw new PlatformError("Provider balance does not match its payment source.");
    await serviceRpc("balance_apply",{p_order:order,p_account:account,p_transaction:id,p_source:source,p_amount:balance.amount,p_fee:balance.fee,p_net:balance.net,p_currency:balance.currency,p_created:new Date(balance.created*1000).toISOString()});
  }
  async function list(path:string) {const result=await stripe(path);if(!Array.isArray(result.data)||result.has_more!==false||result.data.length>100)throw new PlatformError("Provider adjustments need paginated reconciliation.");return result.data;}
  await observe(charge.id,charge.balance_transaction);
  if(charge.amount_refunded>0){for(const refund of await list(`refunds?charge=${encodeURIComponent(charge.id)}&limit=100`)){if(objectId(refund.charge)!==charge.id||refund.livemode===true)throw new PlatformError("Refund source mismatch.");await observe(refund.id,refund.balance_transaction);}}
  if(charge.disputed){for(const dispute of await list(`disputes?charge=${encodeURIComponent(charge.id)}&limit=100`)){if(objectId(dispute.charge)!==charge.id||dispute.livemode===true||!Array.isArray(dispute.balance_transactions))throw new PlatformError("Dispute source mismatch.");for(const balance of dispute.balance_transactions)await observe(dispute.id,balance);}}
  const transferId=objectId(charge.transfer);
  if(transferId){if(!/^tr_[A-Za-z0-9]+$/.test(transferId))throw new PlatformError("Invalid transfer reference.");const transfer=await stripe(`transfers/${transferId}`);if(transfer.id!==transferId||(transfer.source_transaction && objectId(transfer.source_transaction)!==charge.id)||objectId(transfer.destination)!==destination||transfer.livemode!==false)throw new PlatformError("Transfer source mismatch.");await observe(transfer.id,transfer.balance_transaction);
    if(transfer.amount_reversed>0)for(const reversal of await list(`transfers/${transferId}/reversals?limit=100`)){if(objectId(reversal.transfer)!==transferId)throw new PlatformError("Transfer reversal mismatch.");await observe(reversal.id,reversal.balance_transaction);}
  }
  const feeId=objectId(charge.application_fee);
  if(feeId){if(!/^fee_[A-Za-z0-9]+$/.test(feeId))throw new PlatformError("Invalid application fee reference.");const fee=await stripe(`application_fees/${feeId}`);if(fee.id!==feeId||objectId(fee.originating_transaction ?? fee.charge)!==charge.id||objectId(fee.account)!==destination||fee.livemode!==false)throw new PlatformError("Application fee source mismatch.");await observe(fee.id,fee.balance_transaction);
    if(fee.amount_refunded>0)for(const refund of await list(`application_fees/${feeId}/refunds?limit=100`)){if(objectId(refund.fee)!==feeId)throw new PlatformError("Application fee refund mismatch.");await observe(refund.id,refund.balance_transaction);}
  }
}
