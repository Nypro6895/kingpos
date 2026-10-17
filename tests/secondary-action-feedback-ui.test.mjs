import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';
import { chromium } from 'playwright-core';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(browserPath);
let bundlePromise;
function bundle() {
  if (bundlePromise) return bundlePromise;
  const profile = readFileSync('app/salon-profile/salon-profile-view.tsx', 'utf8');
  const ast = ts.createSourceFile('profile.tsx', profile, ts.ScriptTarget.Latest, true);
  const button = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Button');
  assert.ok(button, 'exercise the actual profile Button implementation');
  bundlePromise = build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';import{createRoot}from'react-dom/client';import{useFormStatus}from'react-dom';
      import{ActionFeedback}from'./components/action-feedback';
      import{BookingPolicyPanel}from'./app/market/booking-policy-panel';import{VietnamesePluginPanel}from'./app/market/vietnamese-plugin-panel';
      import{CardCheckoutPanel}from'./app/market/card-checkout-panel';import{SupportConversationPanel}from'./app/support/support-ui';
      import{AdminSupportHub}from'./app/(app)/admin/_components/admin-support-hub';
      import{BusinessesWorkspace}from'./app/(app)/admin/locations/businesses-workspace';
      import{StartupSearchForm}from'./components/startup-controls';
      ${button.getText(ast)}
      window.calls=[];window.tasks=[];window.opened=[];window.refreshes=0;
      window.action=(name,args=[])=>new Promise((resolve,reject)=>{window.calls.push({name,args:args.map(value=>value instanceof FormData?Object.fromEntries([...value].map(([key,value])=>[key,value instanceof File?value.name:value])):value)});window.tasks.push({name,resolve,reject,settled:false});});
      window.finish=(name,value,reject=false)=>{const task=window.tasks.find(task=>task.name===name&&!task.settled);if(!task)throw Error('No pending '+name);task.settled=true;reject?task.reject(Error(value)):task.resolve(value);};
      window.fetch=async(url,options)=>{if(options?.method==='POST')return window.action('markRead',[JSON.parse(options.body)]);return new Response(JSON.stringify({items:[{id:'notice',title:'Fixture notification',href:'/admin/reports',created_at:'2026-10-15T00:00:00Z',can_chat:false,unread:true}],unread_count:1}),{headers:{'Content-Type':'application/json'}});};
      const conversation={id:'fixture-case',summary:'Fixture conversation',reference:'CASE-1',status:'open',context:{},messages:[],attachments:[],admin_view:false};
      const billing={salon_id:'fixture',catalog:[{plugin_id:'booking-policy',published:true,fulfillment_ready:true,price_cents:99}],settings:{tax_bps:0,fee_bps:0,fixed_fee_cents:0}};
      const language={installed:true,active:false,has_subscription:true,staff_enabled:true,portable_enabled:false,trial_ends_at:null};
      const businesses={items:[],total:0,page:3,counts:{all:0,active:0,new:0,unclaimed:0,review:0,followup:0},cities:['Milwaukee'],reviews:[],review_total:0,missing_contact_total:0,missing_contacts:[],followup_due_total:0,followups:[]};
      function App(){const screen=location.pathname;return screen==='/startup'?<><StartupSearchForm/><iframe name='startup-result' title='Startup GET result'/></>:screen==='/businesses'?<BusinessesWorkspace data={businesses} permissions={[]} actorId='fixture-admin'/>:screen==='/market'?<><BookingPolicyPanel state={{active:false,subscribed:false,content:'Original rules',published:false}}/><VietnamesePluginPanel initialState={language} onChange={()=>{window.languageChanged=true}}/><CardCheckoutPanel pluginId='booking-policy' pluginName='Booking rules' billingState={billing} hasActiveSubscription={false} ready onStateChange={()=>{}}/></>:screen==='/support'?<SupportConversationPanel conversation={conversation} embedded onRefresh={()=>window.action('supportRefresh')}/>:screen==='/admin'?<AdminSupportHub/>:<form action={data=>window.action('profileSave',[data])}><input name='business_name' aria-label='Salon name' defaultValue='Original salon'/><Button>Preview</Button><Button type='submit' variant='primary'>Save changes</Button></form>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'secondary-feedback-isolated-actions', setup(builder) {
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)workspace-language$/ }, () => ({ path: 'language', namespace: 'fixture' }));
      builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:booking-policy-actions|vietnamese-actions|card-payment-actions)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /^\.\/actions$/ }, args => args.importer.endsWith('/support/support-ui.tsx') || args.importer.endsWith('\\support\\support-ui.tsx') ? { path: 'support-actions', namespace: 'fixture' } : undefined);
      builder.onResolve({ filter: /(?:open-market-payment|market-checkout-url|ios-client)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)(?:admin-icon|dashboard-detail|dashboard-action-form|account-actions|workspace-actions)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /^\.\.\/actions$/ }, args => args.importer.endsWith('businesses-workspace.tsx') ? { path: 'admin-location-actions', namespace: 'fixture' } : undefined);
      builder.onResolve({ filter: /\.\/admin-(?:icon|conversation-chat)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /^@stripe\/stripe-js\/pure$/ }, () => ({ path: 'stripe', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
        const name = args.path;
        let contents;
        if (name === 'css') contents = 'export default new Proxy({},{get:(_,key)=>String(key)})';
        else if (name === 'language') contents = 'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>value=>value;';
        else if (name === 'next/navigation') contents = 'import{startTransition}from"react";const router={refresh(){window.refreshes++},push(href,options){if(location.pathname==="/businesses")startTransition(async()=>{await window.action("businessNavigation",[href,options]);});}};export const useRouter=()=>router;export const useSearchParams=()=>new URLSearchParams(location.search);';
        else if (name === 'next/link') contents = 'export default function Link({children,...props}){return <a {...props}>{children}</a>}export const useLinkStatus=()=>({pending:false});';
        else if (name.endsWith('booking-policy-actions')) contents = 'export const saveBookingPolicy=(...args)=>window.action("saveRules",args);export const bookingPolicyPaymentAction=(...args)=>window.action("rulesPayment",args);';
        else if (name.endsWith('vietnamese-actions')) contents = 'export const setVietnamesePlugin=(...args)=>window.action("saveLanguage",args);export const vietnamesePaymentAction=(...args)=>window.action("languagePayment",args);';
        else if (name.endsWith('card-payment-actions')) contents = 'export const startCardCheckout=(...args)=>window.action("startCard",args);export const refreshCardPurchase=(...args)=>window.action("checkCard",args);';
        else if (name === 'support-actions') contents = 'export const createSupportRequest=(...args)=>window.action("supportCreate",args);export const sendSupportMessage=(...args)=>window.action("supportSend",args);export const sendGuestSupportMessage=sendSupportMessage;export const uploadSupportEvidence=(...args)=>window.action("supportUpload",args);export const reopenContentReportReview=(...args)=>window.action("supportReopen",args);';
        else if (name.endsWith('open-market-payment')) contents = 'export const openMarketPayment=url=>window.opened.push(url);';
        else if (name.endsWith('market-checkout-url')) contents = 'export const isMarketCheckoutURL=()=>true;';
        else if (name.endsWith('ios-client')) contents = 'export const isReylumiIOSClient=()=>false;';
        else if (name.endsWith('admin-icon')) contents = 'export const AdminIcon=()=>null;';
        else if (name.endsWith('dashboard-detail')) contents = 'export const DashboardDetailPanel=()=>null;';
        else if (name.endsWith('dashboard-action-form')) contents = 'export const DashboardActionForm=()=>null;';
        else if (name.endsWith('account-actions')) contents = 'export const dashboardAccountAction=()=>{throw Error("Unexpected admin mutation")};export const saveDashboardFollowupAction=dashboardAccountAction;';
        else if (name.endsWith('workspace-actions')) contents = 'export const takeBusinessReviewAction=()=>{throw Error("Unexpected admin mutation")};export const bulkBusinessFollowupAction=takeBusinessReviewAction;export const businessStatusAction=takeBusinessReviewAction;';
        else if (name === 'admin-location-actions') contents = 'export const updateAdminLocationProfileAction=()=>{throw Error("Unexpected admin mutation")};export const createAdminNoteAction=updateAdminLocationProfileAction;';
        else if (name === './admin-conversation-chat') contents = 'export const AdminConversationChat=()=>null;';
        else if (name === 'stripe') contents = 'export const loadStripe=()=>{throw Error("External SDK must not run in this fixture")};';
        else throw Error('Unknown fixture dependency: ' + name);
        return { contents, loader: 'tsx', resolveDir: process.cwd() };
      });
    } }],
  });
  return bundlePromise;
}
async function fixture(screen) {
  const compiled = await bundle();
  const nativeGets = [];
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(compiled.outputFiles[0].text); }
    else if (request.url.startsWith('/explore?')) { nativeGets.push({ method: request.method, url: request.url }); response.setHeader('Content-Type', 'text/html'); response.end('<p>Native startup search received</p>'); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<div id="root"></div><script src="/bundle.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + screen);
  return { page, errors, nativeGets, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}
const finish = (page, name, value, reject = false) => page.evaluate(({ name, value, reject }) => window.finish(name, value, reject), { name, value, reject });
const calls = (page, name) => page.evaluate(name => window.calls.filter(call => call.name === name), name);

test('profile Button keeps default buttons inert and shows actual React form pending without losing input', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/profile');
  try {
    const { page } = app;
    await page.getByLabel('Salon name').fill('Unsubmitted salon name');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    assert.deepEqual(await calls(page, 'profileSave'), [], 'default type remains button');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Saving…', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Preview', exact: true }).isEnabled(), true, 'non-submit controls do not adopt form pending');
    assert.equal(await page.getByLabel('Salon name').inputValue(), 'Unsubmitted salon name');
    assert.equal((await calls(page, 'profileSave')).length, 1);
    assert.equal((await calls(page, 'profileSave'))[0].args[0].business_name, 'Unsubmitted salon name');
    await finish(page, 'profileSave', undefined);
    await page.getByRole('button', { name: 'Save changes', exact: true }).waitFor();
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('Market feedback follows the selected action and transport failures retain drafts without automatic retries', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/market');
  try {
    const { page } = app;
    await page.locator('#booking-policy-content').fill('Keep this edited rule');
    await page.getByRole('button', { name: 'Save rules', exact: true }).click();
    await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
    await finish(page, 'saveRules', 'offline', true);
    await page.getByText('Your changes could not be confirmed.', { exact: false }).waitFor();
    assert.equal(await page.locator('#booking-policy-content').inputValue(), 'Keep this edited rule');
    assert.equal((await calls(page, 'saveRules')).length, 1);
    await page.getByRole('button', { name: 'Subscribe · $0.99 / month', exact: true }).click();
    await page.getByRole('button', { name: 'Opening…', exact: true }).waitFor();
    await finish(page, 'rulesPayment', 'offline', true);
    await page.getByText('Checkout could not be confirmed.', { exact: false }).waitFor();
    const language = page.getByRole('region', { name: 'Tùy chọn plugin tiếng Việt' });
    await language.locator('input[type=checkbox]').first().uncheck();
    await language.getByRole('button', { name: 'Lưu tùy chọn', exact: true }).click();
    await language.getByRole('button', { name: 'Đang lưu…', exact: true }).waitFor();
    await finish(page, 'saveLanguage', 'offline', true);
    await page.getByText('Chưa xác nhận được thay đổi.', { exact: false }).waitFor();
    assert.equal(await language.locator('input[type=checkbox]').first().isChecked(), false);
    assert.deepEqual((await calls(page, 'saveLanguage'))[0].args, [true, false, false]);
    await language.getByRole('button', { name: 'Gỡ plugin', exact: true }).click();
    await language.getByRole('button', { name: 'Đang gỡ…', exact: true }).waitFor();
    await finish(page, 'saveLanguage', { error: 'Fixture unchanged' });
    await language.getByRole('button', { name: 'Quản lý thuê bao', exact: true }).click();
    await language.getByRole('button', { name: 'Đang mở…', exact: true }).waitFor();
    await finish(page, 'languagePayment', 'offline', true);
    await page.getByText('Không thể xác nhận thanh toán.', { exact: false }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.opened), []);
    assert.equal((await calls(page, 'saveLanguage')).length, 2, 'only explicit Save and Remove clicks call the action');
    const card = page.getByRole('region', { name: 'Card payment' });
    await card.getByRole('button', { name: 'Buy with card' }).click();
    await finish(page, 'startCard', { checkoutUrl: 'https://checkout.stripe.com/c/pay/fixture' });
    await card.getByRole('button', { name: 'Check payment status' }).click();
    await card.getByRole('button', { name: 'Checking…' }).waitFor();
    assert.equal(await card.getByRole('button', { name: 'Checking…' }).isDisabled(), true);
    await finish(page, 'checkCard', { message: 'Fixture status checked' });
    await card.getByRole('button', { name: 'Check payment status' }).waitFor();
    assert.equal((await calls(page, 'checkCard')).length, 1);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('support upload and refresh report pending separately and preserve an unsent message on failure', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/support');
  try {
    const { page } = app;
    await page.getByRole('textbox', { name: 'Message support' }).fill('My unsent reply');
    await page.locator('input[type=file]').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF fixture only') });
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await page.getByRole('button', { name: 'Uploading…', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), true);
    await finish(page, 'supportUpload', 'Fixture upload unavailable', true);
    await page.getByText('Fixture upload unavailable', { exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Message support' }).inputValue(), 'My unsent reply');
    assert.equal(await page.locator('input[type=file]').evaluate(input => input.files[0].name), 'fixture.pdf');
    await page.getByRole('button', { name: 'Refresh conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Refreshing…', exact: true }).waitFor();
    await finish(page, 'supportRefresh', 'offline', true);
    await page.getByText('Conversation could not be refreshed.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Message support' }).inputValue(), 'My unsent reply');
    assert.equal((await calls(page, 'supportUpload')).length, 1);
    assert.equal((await calls(page, 'supportRefresh')).length, 1);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('admin mark-read starts pending immediately and recovers from a rejected request without replay', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/admin');
  try {
    const { page } = app;
    await page.getByRole('button', { name: 'Team notifications', exact: true }).click();
    await page.getByText('Fixture notification', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Mark shown as read', exact: true }).click();
    await page.getByRole('button', { name: 'Marking as read…', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Marking as read…', exact: true }).isDisabled(), true);
    await finish(page, 'markRead', 'offline', true);
    await page.getByText('Could not mark notifications read. Please retry.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Mark shown as read', exact: true }).waitFor();
    assert.equal((await calls(page, 'markRead')).length, 1);
    assert.deepEqual((await calls(page, 'markRead'))[0].args[0], { ids: ['notice'] });
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('Tax Company keeps exact server actions and scopes while all four mutation submits use pending buttons', () => {
  const expected = [
    ['app/(app)/tax-company/page.tsx', ['disconnectTaxSalon', 'connectTaxSalon']],
    ['app/(app)/tax-company/[salonId]/page.tsx', ['disconnectTaxSalon']],
    ['app/(app)/payroll/tax-company/settings/page.tsx', ['updateTaxSettings']],
  ];
  for (const [file, actions] of expected) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const found = [];
    function visit(node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'form') {
        const action = node.openingElement.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'action');
        const button = node.children.find(child => ts.isJsxElement(child) && child.openingElement.tagName.getText() === 'SubmitButton');
        assert.ok(button, `${file} mutation submit uses the shared pending component`);
        assert.match(button.getText(), /pendingLabel=/);
        found.push(action.initializer.expression.getText());
        if (found.at(-1) === 'disconnectTaxSalon') assert.match(node.getText(), /name="salon_id"/);
        if (found.at(-1) === 'updateTaxSettings') assert.match(node.getText(), /name="disconnect" value="true"/);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.deepEqual(found, actions);
  }
});

test('native GET feedback preserves every original form action, method, hidden scope and submitter name/value', () => {
  const expected = JSON.parse(readFileSync(new URL('./fixtures/native-get-feedback-baseline.json', import.meta.url), 'utf8'));
  assert.equal(expected.sourceCommit, 'e4e4deb20d2611b49d7e1696f8e200b5e4e4b04c');
  function signatures(file, text, action) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const forms = [];
    const attributes = node => Object.fromEntries(node.attributes.properties.filter(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText() !== 'pendingLabel').map(attribute => [attribute.name.getText(), attribute.initializer?.getText().replace(/\s+/g, ' ') ?? true]));
    function visit(node) {
      if (ts.isJsxElement(node) && ['form', 'NavigationForm'].includes(node.openingElement.tagName.getText())) {
        const attrs = attributes(node.openingElement);
        if (attrs.action === JSON.stringify(action)) {
          const fields = [];
          function collect(child) {
            if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
              const tag = child.tagName.getText();
              if (['input', 'select', 'option', 'button', 'NavigationSubmitButton'].includes(tag)) fields.push({ tag: tag === 'NavigationSubmitButton' ? 'button' : tag, attributes: attributes(child) });
            }
            ts.forEachChild(child, collect);
          }
          ts.forEachChild(node, collect);
          forms.push({ component: node.openingElement.tagName.getText(), attributes: attrs, fields });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    return forms;
  }
  let total = 0;
  const formAttributes = ['action', 'method', 'encType', 'target', 'acceptCharset', 'noValidate', 'id'];
  const fieldAttributes = ['name', 'type', 'value', 'defaultValue', 'checked', 'defaultChecked', 'disabled', 'multiple', 'selected', 'form', 'formAction', 'formMethod', 'formEncType', 'formNoValidate', 'formTarget', 'readOnly', 'required', 'min', 'max', 'step', 'maxLength', 'minLength', 'pattern', 'accept', 'id'];
  const pick = (attributes, names) => Object.fromEntries(Object.entries(attributes).filter(([name]) => names.includes(name)));
  const payload = form => ({
    attributes: { method: '"get"', ...pick(form.attributes, formAttributes) },
    fields: form.fields.map(field => ({ tag: field.tag, attributes: { ...(field.tag === 'button' ? { type: '"submit"' } : {}), ...pick(field.attributes, fieldAttributes) } })),
  });
  for (const { file, action, forms } of expected.files) {
    const composition = file === 'components/app-startup-shell.tsx';
    // The startup placeholder no longer contains a search form. Keep testing
    // the reusable search island's serialization independently of that removal.
    const sourceFile = composition ? 'components/startup-controls.tsx' : file;
    const current = signatures(sourceFile, readFileSync(sourceFile, 'utf8'), action);
    assert.equal(current.length, forms.length, file);
    assert.ok(current.every(form => form.component === (composition ? 'form' : 'NavigationForm')), `${file} uses its native navigation pending owner`);
    assert.deepEqual(current.map(payload), forms.map(payload), `${file} preserves original GET serialization and filters`);
    total += current.length;
  }
  assert.equal(total, 9, 'all nine native GET forms remain covered');
});

test('schedule save and changing a remembered POS ID preserve their server actions and use form pending feedback', () => {
  for (const [file, action] of [
    ['app/payroll/payroll-schedule-form.tsx', 'action'],
    ['app/pos/portable/portable-login-form.tsx', 'forgetPortablePosAccessIdAction'],
  ]) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    let found = false;
    function visit(node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'form') {
        const attr = node.openingElement.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'action');
        if (attr?.initializer?.expression?.getText() === action) {
          assert.match(node.getText(), /<SubmitButton\b/);
          assert.match(node.getText(), /pendingLabel=/);
          found = true;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.equal(found, true, `${file} retains the original action`);
  }
});

test('lightweight startup search keeps its native GET query and draft while showing pending and guarding repeats', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/startup');
  try {
    const { page } = app;
    await page.getByRole('searchbox').fill('Nails near Milwaukee');
    assert.equal(await page.evaluate(() => window.__reylumiStartupSearch.query), 'Nails near Milwaukee');
    assert.equal(await page.evaluate(() => window.__reylumiStartupSearch.route), '/startup');
    await page.getByRole('search').evaluate(form => { form.target = 'startup-result'; });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.frameLocator('iframe').getByText('Native startup search received').waitFor();
    assert.equal(app.nativeGets.length, 1);
    assert.equal(app.nativeGets[0].method, 'GET');
    assert.deepEqual(Object.fromEntries(new URL(app.nativeGets[0].url, 'http://fixture.invalid').searchParams), { q: 'Nails near Milwaukee' });
    assert.equal(await page.getByRole('search').getAttribute('aria-busy'), 'true');
    assert.equal(await page.getByRole('button', { name: 'Search', exact: true }).getAttribute('aria-disabled'), 'true');
    await page.getByRole('search').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(app.nativeGets.length, 1);
    assert.equal(await page.getByRole('searchbox').inputValue(), 'Nails near Milwaukee');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    assert.equal(await page.getByRole('search').getAttribute('aria-busy'), 'false');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('business directory search follows its existing route transition and preserves query filters and unsent edits', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/businesses?status=active&city=Milwaukee&page=3');
  try {
    const { page } = app;
    await page.getByRole('textbox', { name: 'Search businesses', exact: true }).fill('Sunset salon');
    await page.evaluate(() => { window.originalBusinessSearch = document.querySelector('input[name=q]'); });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'Searching…', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Searching…', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Searching…', exact: true }).getAttribute('aria-busy'), 'true');
    const navigation = await calls(page, 'businessNavigation');
    assert.equal(navigation.length, 1);
    const url = new URL(navigation[0].args[0], 'http://fixture.invalid');
    assert.equal(url.pathname, '/admin/locations');
    assert.deepEqual(Object.fromEntries(url.searchParams), { status: 'active', city: 'Milwaukee', q: 'Sunset salon' });
    assert.deepEqual(navigation[0].args[1], { scroll: false });
    await page.getByRole('textbox', { name: 'Search businesses', exact: true }).fill('Further edit not submitted');
    await finish(page, 'businessNavigation', undefined);
    await page.getByRole('button', { name: 'Search', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Search', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('textbox', { name: 'Search businesses', exact: true }).inputValue(), 'Further edit not submitted');
    assert.equal(await page.evaluate(() => document.querySelector('input[name=q]') === window.originalBusinessSearch), true);
    assert.deepEqual((await page.evaluate(() => window.calls)).map(call => call.name), ['businessNavigation'], 'search never invokes an admin mutation');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
