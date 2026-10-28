import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const bundled = await build({ entryPoints: ['lib/app-local-prefetch-plan.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { appLocalPrefetchPlan: plan, appLocalTodayPrefetchJobs: today } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const now = Date.parse('2026-10-27T12:00:00Z');
const viewer = '00000000-0000-4000-8000-000000000001', salon = '00000000-0000-4000-8000-000000000002';
const staff = '00000000-0000-4000-8000-000000000003', revision = '00000000-0000-4000-8000-000000000004';
function context(kind) {
  const personal = kind === 'customer' || kind === 'public', scope = 'v3:' + ({ owner: 'a', staff: 'b', customer: 'c', public: 'd' }[kind]).repeat(64);
  const identity = { scope, authenticated: kind !== 'public', viewerId: kind === 'public' ? null : viewer, workspaceId: personal ? 'personal' : 'workspace', salonId: personal ? null : salon, permissionRevision: 'permission-r1' };
  return { schemaVersion: 1, context: identity, grant: { version: 1, scope, scopes: [scope], viewerId: identity.viewerId, workspaceId: identity.workspaceId, salonId: identity.salonId,
    grantRevision: 'r1', generation: 'generation-0000000001', issuedAt: now - 1000, expiresAt: now + 3600000, path: kind === 'owner' ? '/staff/today' : kind === 'staff' ? '/staff/my-work' : '/explore', kind,
    ...(kind === 'staff' ? { staffBinding: { version: 1, staffId: staff, viewerId: viewer, salonId: salon, revision, approvedAt: '2020-01-01T00:00:00Z' } } : {}) },
    access: { ownerWorkspace: kind === 'owner', staffWorkspace: kind === 'staff' }, display: { name: 'Fixture', language: 'en', role: kind }, onlineValidatedAt: now };
}
const first = (kind, path) => plan(context(kind), path, now)[0];
const shell = (changes = {}) => ({ dashboard: { date: '2026-10-26', noAccess: false, permissions: { canViewBookings: true, canViewReports: true, canViewStaffFinancials: true }, dayView: { isCurrentDate: true }, ...changes } });

test('owner priority matches real mounted cache keys and ordinary default views', () => {
  const jobs = plan(context('owner'), '/', now);
  assert.deepEqual(jobs.slice(0, 11).map(row => row.name), ['page.owner-today', 'owner.bookings', 'owner.salon-profile', 'page.notifications', 'owner.workspace', 'owner.tickets', 'owner.reports', 'page.owner-customers', 'page.owner-staff', 'page.services', 'page.owner-payroll']);
  assert.deepEqual(jobs[0].args, {}, 'omitting phase selects the original complete endpoint response');
  for (const name of ['owner.bookings', 'owner.workspace', 'owner.tickets', 'owner.reports']) assert.deepEqual(jobs.find(row => row.name === name).args, { query: '' });
  assert.deepEqual(jobs.find(row => row.name === 'page.owner-payroll').args, { tab: 'overview' });
  assert.ok(jobs.some(row => row.name === 'page.more') && jobs.some(row => row.name === 'page.my-place'));
  assert.ok(!jobs.some(row => /^staff\.|^customer\.|page\.customer-|page\.beauty/.test(row.name)));
});

test('staff plans bind every staff DTO to the trusted current staff; Post uses salon-profile', () => {
  const jobs = plan(context('staff'), '/', now), staffJobs = jobs.filter(row => row.name.startsWith('staff.'));
  assert.deepEqual(staffJobs.map(row => [row.name, row.args]), [
    ['staff.my-work', { staffId: staff }], ['staff.schedule', { staffId: staff }], ['staff.workday', { staffId: staff }],
    ['staff.my-work', { tab: 'payroll', staffId: staff }], ['staff.my-work', { tab: 'analysis', staffId: staff }],
  ]);
  assert.ok(jobs.some(row => row.path === '/salon-profile' && row.name === 'owner.salon-profile'));
  assert.ok(!jobs.some(row => row.name === 'staff.relay' || row.name === 'page.owner-today' || row.name === 'owner.workspace' || row.name === 'page.owner-payroll'));
  for (const patch of [{ staffId: viewer, viewerId: staff }, { salonId: staff }, { revoked: true }]) {
    const value = context('staff'); Object.assign(value.grant.staffBinding, patch); assert.deepEqual(plan(value, '/', now), []);
  }
  const missing = context('staff'); delete missing.grant.staffBinding; assert.deepEqual(plan(missing, '/', now), []);
});

test('personal and guest plans never pull salon or another role resources', () => {
  const jobs = plan(context('customer'), '/', now);
  for (const name of ['page.explore', 'page.customer-bookings', 'page.beauty', 'customer.activity', 'page.my-place', 'customer.saved-posts', 'customer.following', 'customer.favorites', 'page.more']) assert.ok(jobs.some(row => row.name === name), name);
  assert.ok(!jobs.some(row => /^(?:owner|staff)\.|page\.owner-|page\.services/.test(row.name)));
  assert.deepEqual(plan(context('public'), '/', now).map(row => row.name), ['page.explore', 'page.explore-extras', 'page.explore-feed']);
});

test('accepted authority is never inferred from display role, arbitrary online proof or old leases', () => {
  const owner = context('owner'); owner.display.role = 'customer'; assert.equal(plan(owner, '/', now)[0].name, 'page.owner-today');
  const personal = context('customer'); personal.display.role = 'OWNER'; assert.ok(!plan(personal, '/', now).some(row => row.name === 'page.owner-today'));
  for (const mutate of [value => { value.offline = true; }, value => { value.grant.expiresAt = now; }, value => { value.grant.viewerId = staff; }, value => { value.grant.salonId = staff; }, value => { value.grant.workspaceId = 'other'; }, value => { value.grant.scopes = ['v3:' + 'e'.repeat(64)]; }, value => { value.grant.kind = 'staff'; }, value => { value.offlineState = 'unconfirmed'; }, value => { value.grantStatus = 403; }]) {
    const value = context('owner'); mutate(value); assert.deepEqual(plan(value, '/', now), []);
  }
  const online = context('staff'); online.grant = null; online.offlineState = 'online-only'; online.grantStatus = 503;
  online.staffOnlineAccess = { version: 1, staffId: staff, viewerId: viewer, salonId: salon, scope: online.context.scope };
  assert.deepEqual(plan(online, '/staff/my-work', now), [], 'foreground-only proof is not background authority');
  const fresh = context('owner'); fresh.grant = null; assert.ok(plan(fresh, '/', now).length);
  fresh.onlineValidatedAt = now - 30000; assert.deepEqual(plan(fresh, '/', now), []);
});

test('current route comes first with component-exact query arguments and deduplicates the default', () => {
  assert.deepEqual(first('owner', '/bookings?staff=Alice&date=2026-10-20').args, { query: 'date=2026-10-20&staff=Alice' });
  assert.equal(first('owner', '/reports?date=2026-10-20').name, 'owner.reports');
  assert.deepEqual(first('owner', '/payroll?tab=analytics&month=2026-10&overviewStaff=Alice').args, { month: '2026-10', tab: 'overview' });
  assert.deepEqual(first('owner', '/customers?q=Sam&page=2').args, { page: '2', q: 'Sam' });
  assert.deepEqual(first('owner', '/staff?filter=active&q=Sam&error=notice').args, { error: 'notice', filter: 'active', q: 'Sam' });
  assert.deepEqual(first('staff', '/staff/my-work?tab=payroll&payPeriodStart=2026-10-01&error=notice').args, { tab: 'payroll', payPeriodStart: '2026-10-01', staffId: staff });
  assert.deepEqual(first('staff', '/staff/appointments?view=week&date=2026-10-20').args, { date: '2026-10-20', view: 'week', staffId: staff });
  assert.deepEqual(first('customer', '/more/favorite-shop?q=Sam').args, { q: 'Sam', filter: 'shop' });
  assert.deepEqual(first('customer', '/explore?q=nails&page=2&location=Chicago').args, { query: 'location=Chicago&q=nails' });
  assert.equal(plan(context('owner'), '/pos', now).filter(row => row.name === 'owner.workspace').length, 1);
});

test('forms, recovery and sensitive callbacks cannot start speculative work', () => {
  for (const path of ['/customers/new', `/customers/${viewer}/edit`, '/login', '/account-recovery', '/payroll?tab=settings', '/staff?add=1', '/staff?setup=1', '/staff/my-work?profile=1', '/pos?payment=success', '/explore?next=%2Fpos', '/explore?access_token=secret', '//outside.test/pos', '/explore#payment', '/pos?date=1&date=2']) {
    assert.deepEqual(plan(context('owner'), path, now), [], path);
  }
});

test('Today sections use only accepted server date and exact permission-filtered phase cache keys', () => {
  const jobs = today(context('owner'), shell(), now);
  assert.deepEqual(jobs.map(row => row.args), ['staff', 'bookings', 'waiting', 'financials', 'extras'].map(phase => ({ date: '2026-10-26', phase })));
  assert.deepEqual(today(context('owner'), shell({ permissions: { canViewBookings: false, canViewReports: false, canViewStaffFinancials: false } }), now).map(row => row.args.phase), ['staff', 'extras']);
  assert.deepEqual(today(context('owner'), shell({ dayView: { isCurrentDate: false } }), now).map(row => row.args.phase), ['staff', 'bookings', 'financials', 'extras']);
  for (const invalid of [null, {}, shell({ date: undefined }), shell({ date: 'invalid' }), shell({ noAccess: true }), shell({ permissions: {} })]) assert.deepEqual(today(context('owner'), invalid, now), []);
  assert.deepEqual(today(context('staff'), shell(), now), []);
  assert.deepEqual(today(context('customer'), shell(), now), []);
});

test('planned descriptors are retained named reads with declared argument keys, never actions or control reads', async () => {
  const metadata = ['app-local-role-resources', 'app-local-platform-types', 'app-local-personal-metadata', 'app-local-business-metadata', 'app-local-explore-metadata'];
  const entries = metadata.map(name => `export * from './${name}';`).join('\n');
  const result = await build({ stdin: { contents: entries, resolveDir: process.cwd() + '/lib', loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
  const rules = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const owner = JSON.parse(readFileSync('lib/app-local-owner-page-registry.json', 'utf8')).reads;
  for (const kind of ['owner', 'staff', 'customer', 'public']) {
    const value = context(kind), jobs = [...plan(value, '/', now), ...today(value, shell(), now)];
    for (const job of jobs) {
      assert.ok(!/^http\.|^shell\.|action|command|relay|identity|admission|payment/.test(job.name));
      const rule = rules.APP_LOCAL_READ_RESOURCES[job.name] ?? rules.APP_LOCAL_PLATFORM_READS[job.name] ?? rules.APP_LOCAL_PERSONAL_READS[job.name] ?? rules.APP_LOCAL_BUSINESS_READS[job.name] ?? rules.APP_LOCAL_EXPLORE_READS.find(row => row.name === job.name) ?? owner[job.name];
      const keys = rule?.params ?? rule?.argumentKeys ?? (job.name.startsWith('owner.') ? ['query'] : null);
      assert.ok(keys, job.name);
      for (const key of Object.keys(job.args)) assert.ok(keys.includes(key), `${job.name}.${key}`);
      assert.ok(rule?.retention !== 'none' && rule?.cacheable !== false && rule?.retain !== false);
    }
    assert.deepEqual(plan(value, '/', now).map(row => row.rank), plan(value, '/', now).map((_, index) => index));
  }
});
