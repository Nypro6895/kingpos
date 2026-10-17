import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function fixture(entry = "app/settings/plugin-settings-actions.ts") {
  const state = {
    authorized: true, salonId: "salon-a", calls: [], reads: [],
    policy: { active: true, subscribed: true, content: "Original rules", published: false },
    sms: { active: true, installed: true, enabled: true, confirmation: true, reminders: false, accountSid: "saved-account", messagingServiceSid: "saved-service", from: "+15555550000", tokenConfigured: true },
  };
  globalThis.__pluginSettings = state;
  const bundle = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", plugins: [{ name: "inert-dependencies", setup(b) {
    b.onResolve({ filter: /^(next\/cache|@\/)/ }, args => ({ path: args.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ contents: `const s=globalThis.__pluginSettings;` + (
      args.path === "next/cache" ? `export const revalidatePath=()=>{};` :
      args.path.endsWith("settings-target-context") ? `export async function withSettingsTarget(id,run){if(!s.authorized||id!==s.salonId)throw Error('Salon owner access required.');s.reads.push(['scope',id]);return run();}` :
      args.path.endsWith("market-plugins") ? `export async function marketPluginContext(){return {salonId:s.salonId}};export async function payrollDataPluginInstalled(){s.reads.push('payroll');return true}` :
      args.path.endsWith("booking-policy-subscription") ? `export async function bookingPolicySubscription(id){s.reads.push(['rules',id]);return {...s.policy}}` :
      args.path.endsWith("booksms") ? `export async function bookSmsState(){s.reads.push('sms');return {...s.sms}}` :
      args.path.endsWith("booking-policy-actions") ? `export async function saveBookingPolicy(content,published){s.calls.push({type:'rules',content,published});return s.saveError?{error:s.saveError}:{saved:true}}` :
      args.path.endsWith("booksms-actions") ? `export async function saveBookSms(form){s.calls.push({type:'sms',form:Object.fromEntries(form)});return s.saveError?{error:s.saveError}:{state:{...s.sms,enabled:form.has('enabled'),confirmation:form.has('confirmation'),reminders:form.has('reminders')}}}` :
      args.path.endsWith("checkin-receipt-subscription") ? `export async function checkinReceiptSubscription(){if(s.failReceipt)throw Error('Unavailable');s.reads.push('receipt');return {active:true}}` :
      args.path.endsWith("tax-company-subscription") ? `export async function taxCompanySubscription(){s.reads.push('tax');return {active:false}}` :
      args.path.endsWith("service-relay/actions") ? `export async function serviceRelayInstalled(){s.reads.push('relay');return false}` :
      args.path.endsWith("credit-actions") ? `export async function campaignWalletAction(){s.reads.push('campaigns');return {installed:true}}` :
      `throw Error('Unexpected dependency: ${args.path}');`
    ) }));
  } }] });
  const module = { exports: {} };
  new Function("module", "exports", bundle.outputFiles[0].text)(module, module.exports);
  return { state, api: module.exports };
}

test("compact saves keep the selected salon, SMS sender, token retention and rule content", async () => {
  const { state, api } = await fixture();
  const result = await api.saveBookSmsSettingsAction("salon-a", { enabled: false, confirmation: false, reminders: true });
  assert.equal(result.state.enabled, false);
  assert.deepEqual(state.calls[0], { type: "sms", form: { installed: "on", reminders: "on", accountSid: "saved-account", messagingServiceSid: "saved-service", from: "+15555550000" } });
  assert.equal("authToken" in state.calls[0].form, false, "existing token must be retained by the original action");
  const content = "Please arrive early.\nCall to reschedule.";
  await api.saveBookingRulesSettingsAction("salon-a", content, true);
  assert.deepEqual(state.calls[1], { type: "rules", content, published: true });
});

test("unauthorized salons and inactive plugins cannot write through compact settings", async () => {
  const { state, api } = await fixture();
  for (const authorized of [false, true]) {
    state.authorized = authorized;
    const id = authorized ? "another-salon" : "salon-a";
    assert.ok((await api.loadBookingRulesSettingsAction(id)).error);
    assert.ok((await api.loadBookSmsSettingsAction(id)).error);
    assert.ok((await api.saveBookingRulesSettingsAction(id, "Rules", true)).error);
    assert.ok((await api.saveBookSmsSettingsAction(id, { enabled: true, confirmation: true, reminders: true })).error);
  }
  assert.deepEqual(state.calls, []); assert.deepEqual(state.reads, []);
  state.sms.installed = false;
  assert.ok((await api.saveBookSmsSettingsAction("salon-a", { enabled: true, confirmation: true, reminders: true })).error);
  state.policy.active = false;
  assert.ok((await api.saveBookingRulesSettingsAction("salon-a", "Rules", true)).error);
  assert.deepEqual(state.calls, []);
  assert.ok((await api.saveBookingRulesSettingsAction("salon-a", "Rules", false)).state, "subscribed owner can still hide expired rules");
  assert.ok((await api.saveBookSmsSettingsAction("salon-a", { enabled: "yes", confirmation: true, reminders: true })).error);
});

test("plugin status reads remain owner scoped, exclude language, and preserve unknown status", async () => {
  const { state, api } = await fixture("app/settings/plugin-market-status-actions.ts");
  assert.ok((await api.loadPluginMarketStatusAction("another-salon", "pos")).error);
  assert.deepEqual(state.reads, []);
  const salon = await api.loadPluginMarketStatusAction("salon-a", "salon");
  assert.deepEqual(salon.rows.map(row => row.name), ["Campaigns"]);
  state.failReceipt = true;
  const pos = await api.loadPluginMarketStatusAction("salon-a", "pos");
  assert.ok(pos.rows[0].error); assert.equal(pos.rows[1].active, false);
  const payroll = await api.loadPluginMarketStatusAction("salon-a", "payroll");
  assert.deepEqual(payroll.rows.map(row => [row.name, row.active]), [["Payroll Data Download", true], ["Tax Company", false]]);
  assert.deepEqual(state.calls, []);
});
