import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
const root = process.cwd(), policy = JSON.parse(fs.readFileSync('lib/app-local-owner-page-registry.json', 'utf8'));
const scope = 'v3:' + 'a'.repeat(64), id = '00000000-0000-4000-8000-000000000001';
const plugin = { name: 'original-getters-fixture-only', setup(builder) {
  builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'fixture' }));
  builder.onResolve({ filter: /^\.\// }, args => {
    if (!args.importer.endsWith('app-local-owner-page-registry-server.ts') || args.path.endsWith('.json')) return;
    return { path: args.path, namespace: 'fixture' };
  });
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
    const definitions = {
      './request-business-context': 'export async function getRequestBusinessContext(){return F.context}',
      './experience-context': 'export function getExperienceContext(c){return {scope:c.scope}}',
      './current-context': 'export function isSalonManageContext(c){return c.manage===true} export function isOwnerMembership(m){return m?.owner===true}',
      './permissions': 'export async function hasPermission(name){return F.permissions.includes(name)}',
      './staff': 'export const STAFF_PERMISSIONS={view:"staff.view",manage:"staff.manage"};export async function getCurrentSalonStaffDirectory(){F.calls.push(["staff"]);return {context:F.context,staff:F.staff}}',
      './booking-setup': 'export async function getCurrentSalonBookingSetup(){return F.bookingSetup}',
      './staff-salon-connections': 'export async function getSalonStaffConnectionRequests(){F.calls.push(["requests"]);return {requests:F.requests}} export async function searchStaffAccountExact(args){F.calls.push(["lookup",args]);return F.lookup}',
      './staff-offline-binding-server': 'export async function getManagedStaffOfflineBinding(c,id){F.calls.push(["binding",id]);return F.binding}',
      './customers': 'export async function getCurrentSalonCustomerList(args){F.calls.push(["customers",args]);return {context:F.resultContext??F.context,customers:F.customers,pagination:F.pagination}} export async function getCurrentSalonCustomerDetail(id,args){F.calls.push(["detail",id,args]);return {context:F.resultContext??F.context,data:F.detail}} export async function getCurrentSalonCustomer(id){F.calls.push(["customer",id]);return {context:F.resultContext??F.context,customer:F.customer}}',
      './beauty-relationship': 'export async function resolveBeautyProfileForSalonCustomer(args){F.calls.push(["beauty",args.customerId]);return F.beauty}',
      './payroll': 'export async function getPayrollPageData(args){F.calls.push(["payroll",args]);return {...F.payroll,context:F.resultContext??F.context}}',
      './tax-company': 'export async function taxCompanySettings(){F.calls.push(["tax"]);return F.tax}',
      './market-plugins': 'export async function payrollDataPluginInstalled(){return F.downloadEnabled}',
      './bounded-get': 'export async function runReadWithDeadline(value){return await value}',
    };
    return { contents: 'const F=globalThis.__appLocalOwnerFixture;\n' + (definitions[args.path] ?? ''), loader: 'js' };
  });
} };
const built = await build({ absWorkingDir: root, entryPoints: ['lib/app-local-owner-page-registry-server.ts'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [plugin] });
async function fixture() {
  const F = { context: { scope, manage: true, user: { id, auth_user_id: 'auth-fixture' }, currentSalon: { id, name: 'Fixture salon' }, currentAccount: { id }, currentBusiness: { id }, currentMembership: { owner: true } }, permissions: ['staff.view', 'staff.manage', 'payroll.manage', 'customers.view', 'customers.manage'], calls: [], staff: [{ id, is_active: true, account_user_id: null, user_id: null }], bookingSetup: { readinessByStaffId: {} }, requests: [{ id, status: 'pending', direction: 'staff_application' }], binding: { viewerId: id, revision: 'binding-fixture', approvedAt: '2026-10-16T00:00:00Z' }, lookup: { status: 'not_found' }, customers: [{ id, name: 'Private customer fixture' }], pagination: { count: 1, page: 1, pageCount: 1, pageSize: 30 }, customer: { id, name: 'Private customer fixture' }, detail: { customer: { id, customer_user_id: id }, tickets: [{ id, grand_total: 44.25 }] }, beauty: { status: 'found' }, payroll: { latestStatement: { run: { status: 'paid', version: 3 } }, live: { lines: [{ staff_id: id, final_staff_income: 44.25 }] }, difference: { changed: false } }, tax: { installed: true }, downloadEnabled: true };
  globalThis.__appLocalOwnerFixture = F;
  const module = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text + '\n//' + Math.random()).toString('base64'));
  return { F, read: (name, args = {}, options = {}) => module.readAppLocalOwnerPageResource(name, args, { scope, ...options }) };
}
test('original authorization and exact requested scope gate every owner page read', async () => {
  const { F, read } = await fixture();
  await assert.rejects(read('page.owner-staff', {}, { scope: 'v3:' + 'b'.repeat(64) }), error => error.status === 409);
  F.context.manage = false; await assert.rejects(read('page.owner-customers'), error => error.status === 403);
  F.context.manage = true; F.context.user = null; await assert.rejects(read('page.owner-payroll'), error => error.status === 401);
  assert.equal(F.calls.length, 0);
});
test('staff keeps original approval/reconfirmation DTO, permission gates and account lookup', async () => {
  const { F, read } = await fixture();
  const value = await read('page.owner-staff', { staff: id, invite_email: '  fixture@example.invalid  ' });
  assert.equal(value.data.experienceScope, scope); assert.equal(value.data.canBecomeStaff, true); assert.deepEqual(value.data.offlineBinding, F.binding); assert.deepEqual(value.data.connectionRequests, F.requests);
  assert.equal(value.data.directory.context, undefined); assert.ok(F.calls.some(([name]) => name === 'binding')); assert.deepEqual(F.calls.find(([name]) => name === 'lookup')[1], { email: 'fixture@example.invalid', phone: null });
  F.calls = []; F.permissions = ['staff.view']; const restricted = await read('page.owner-staff', { staff: id });
  assert.equal(restricted.data.canManageStaff, false); assert.deepEqual(restricted.data.connectionRequests, []); assert.equal(restricted.data.offlineBinding, null); assert.ok(!F.calls.some(([name]) => name === 'requests' || name === 'binding'));
});
test('customer DTOs use original salon-bound getters and never bypass edit permission', async () => {
  const { F, read } = await fixture();
  const listing = await read('page.owner-customers', { page: '2', q: 'Mai' }); assert.deepEqual(listing.data.customers, F.customers); assert.deepEqual(F.calls.at(-1), ['customers', { page: '2', search: 'Mai' }]);
  const detail = await read('page.owner-customer-detail', { customerId: id, group: 'walking' }); assert.deepEqual(detail.data.data, F.detail); assert.deepEqual(F.calls.find(([name]) => name === 'detail'), ['detail', id, { walkingGroup: true }]);
  F.permissions = []; await assert.rejects(read('page.owner-customer-form', { customerId: id }), error => error.status === 403);
  F.permissions = ['customers.manage']; F.resultContext = { ...F.context, scope: 'v3:' + 'c'.repeat(64) }; await assert.rejects(read('page.owner-customer-form', { customerId: id }), error => error.status === 409);
});
test('payroll preserves original recorded totals/status and strips only private request context', async () => {
  const { F, read } = await fixture();
  const value = await read('page.owner-payroll', { tab: 'tax', preset: 'current_month' });
  assert.deepEqual(value.data.payroll, F.payroll); assert.equal(value.data.payroll.context, undefined); assert.equal(value.data.payroll.latestStatement.run.status, 'paid'); assert.equal(value.data.payroll.live.lines[0].final_staff_income, 44.25);
  assert.equal(F.calls.find(([name]) => name === 'payroll')[1].includeAnalytics, false); assert.ok(F.calls.some(([name]) => name === 'tax'));
  const same = await read('page.owner-payroll', { tab: 'tax', preset: 'current_month' }, { etag: value.etag }); assert.equal(same.status, 304); assert.equal(Object.hasOwn(same, 'data'), false);
});
test('unknown resource, arbitrary arguments, secrets and malformed IDs cannot select a getter', async () => {
  const { F, read } = await fixture(); assert.equal(await read('not.registered'), null);
  for (const [name, args] of [['page.owner-staff', { invite_token: 'private' }], ['page.owner-customer-detail', { customerId: '../other' }], ['page.owner-payroll', { url: 'https://evil.invalid' }]]) await assert.rejects(read(name, args), error => error.status === 400);
  assert.equal(F.calls.length, 0); assert.equal(policy.reads['page.owner-customer-form'].cacheable, false);
});
test('all original JSX and authority controls are preserved by the mechanical view extraction', () => {
  const cases = [
    ['app/(app)/staff/page.tsx', 'lib/app-local-owner-staff-view.tsx', 'StaffPage', 'AppLocalOwnerStaffView'],
    ['app/(app)/customers/page.tsx', 'lib/app-local-owner-customers-view.tsx', 'CustomersPage', 'AppLocalOwnerCustomersView'],
    ['app/(app)/customers/[customerId]/page.tsx', 'lib/app-local-owner-customer-detail-view.tsx', 'CustomerDetailPage', 'AppLocalOwnerCustomerDetailView'],
    ['app/(app)/payroll/page.tsx', 'lib/app-local-owner-payroll-view.tsx', 'PayrollPage', 'AppLocalOwnerPayrollView'],
  ];
  const normalize = text => text.replaceAll('getExperienceContext(context).scope', 'experienceScope').replaceAll('pageContext.currentSalon.name', 'salonName').replaceAll('pageContext.currentSalon.id', 'salonId').replace(/\s+/g, '');
  for (const [original, local, name, adapted] of cases) {
    const parse = file => ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const before = parse(original), after = parse(local);
    const main = (ast, target) => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === target);
    const returns = node => node.body.statements.filter(ts.isReturnStatement).at(-1).getText();
    assert.equal(normalize(returns(main(before, name))), normalize(returns(main(after, adapted))), original);
    for (const helper of before.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text !== name)) {
      const match = main(after, helper.name.text); assert.ok(match, `${local} missing ${helper.name.text}`);
      const source = helper.getText().replace('async function ', 'function ').replaceAll('const __vt = await getWorkspaceTranslation();', 'const __vt = useWorkspaceTranslation();');
      assert.equal(normalize(match.getText()), normalize(source), `${original} helper changed: ${helper.name.text}`);
    }
  }
});
