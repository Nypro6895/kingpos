import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function fixture({ failPayment = false, failPayroll = false, bankVersion = 0 } = {}) {
  const calls = [];
  let release;
  const first = new Promise(resolve => { release = resolve; });
  const installedLanguage = { active: true, installed: true, paid_until: '2027-01-01' };
  const getter = (name, value) => async () => { calls.push(name); if (name === 'counts') await first; if ((failPayment && name === 'payment-settings') || (failPayroll && name === 'payroll')) throw new Error(name); return value; };
  const modules = {
    'server-only': {}, '@/lib/booksms': { bookSmsState: getter('sms', {}) }, '@/lib/tax-company-subscription': { taxCompanySubscription: getter('tax', { active: true }) }, '@/lib/platform-payment': { paymentConfig: getter('card', { enabled: true, mode: 'live', webhookSecret: 'fixture' }) }, '@/lib/market-tax': { marketTaxCheckoutSettings: getter('tax-settings', {}) }, '@/lib/booking-deposit': { bookingDepositState: getter('deposit', {}) }, '@/app/service-relay/actions': { serviceRelayInstalled: getter('relay', true) }, '@/lib/booking-policy-subscription': { bookingPolicySubscription: getter('policy', {}) }, '@/lib/market-installation-counts': { marketInstallationCounts: getter('counts', { campaigns: 4 }) }, '@/lib/checkin-receipt-subscription': { checkinReceiptSubscription: getter('receipt', {}) }, '@/app/campaigns/credit-actions': { campaignWalletAction: getter('campaign', { installed: true }) }, '@/lib/market-plugins': { payrollDataPluginInstalled: getter('payroll', true) }, '@/lib/vietnamese-plugin': { vietnamesePluginState: getter('language', installedLanguage) }, '@/types/vietnamese-plugin': { EMPTY_VIETNAMESE_PLUGIN: {} }, '@/lib/market-payments': { marketPaymentSettings: getter('payment-settings', { enabled: true, vietnamese_published: false }), marketPaymentReady: () => true }, '@/lib/market-bank-billing': { marketBankBillingState: getter('bank', { settings: { version: bankVersion } }) }, '@/lib/experience-context': { getExperienceContext: () => ({ scope: 'authorized-owner-salon' }) },
  };
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync('lib/market-experience-data.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => { assert.ok(name in modules, name); return modules[name]; }, exports);
  return { calls, release, run: query => exports.loadMarketExperienceData({ currentSalon: { id: 'salon' } }, query), installedLanguage };
}

test('Market independent reads start together and preserve authorized plugin and payment values', async () => {
  const f = fixture();
  const result = f.run({ payment: 'received' });
  await Promise.resolve(); await Promise.resolve();
  for (const name of ['counts', 'bank', 'relay', 'payroll', 'campaign', 'language', 'receipt', 'policy', 'deposit', 'card', 'tax-settings', 'tax', 'sms']) assert.ok(f.calls.includes(name), name);
  f.release();
  const data = await result;
  assert.equal(data.paymentReturn, 'received');
  assert.equal(data.paymentsAvailable, true);
  assert.equal(data.vietnameseState, f.installedLanguage);
  assert.equal(data.vietnamesePublished, false);
  assert.equal(data.experienceScope, 'authorized-owner-salon');
  assert.equal(data.pluginLoadError, '');
  assert.equal(new Set(f.calls).size, f.calls.length, 'read once per resource');
});

test('Market parallel resolution keeps error precedence, installed language on settings failure, and bank checkout guard', async () => {
  const f = fixture({ failPayment: true, failPayroll: true });
  f.release();
  const data = await f.run({ bookingStripe: 'failed' });
  assert.equal(data.pluginLoadError, 'payroll');
  assert.equal(data.paymentsAvailable, false);
  assert.equal(data.vietnameseState, f.installedLanguage);
  assert.equal(data.vietnamesePublished, true);
  const bank = fixture({ bankVersion: 1 }); bank.release();
  assert.equal((await bank.run()).paymentsAvailable, false);
});
