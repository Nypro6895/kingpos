// Generate test-only DTOs with the real Today loader and existing synthetic adapters.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const original = readFileSync('tests/today-dashboard-progressive.test.mjs', 'utf8');
const prefix = original.slice(0, original.indexOf("\ntest('shell resolves"));
assert.ok(prefix.length > 1000, 'The reviewed Today fixture preamble must exist');
const body = prefix.replace(/^import .*;\r?\n/gm, '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const phases = await new AsyncFunction('assert', 'readFileSync', 'ts', body + `
  const result = {};
  for (const phase of ['shell', ...sections.TODAY_DASHBOARD_SECTIONS, 'full']) {
    const f = fixture(); result[phase] = await f.getTodayDashboard(f.context, { phase });
  }
  return result;
`)(assert, readFileSync, ts);
const summary = { items: [], beautyPublicationRequests: 0, bookingNotifications: 0, managerApplications: 0, previewItems: [], reviewHref: '/notifications', staffApplications: 0, staffInvites: 0, total: 0 };
const workspace = {
  accountId: '00000000-0000-4000-8000-000000000005', accountName: 'Synthetic account', avatarUrl: null,
  businessId: '00000000-0000-4000-8000-000000000002', businessMode: 'manage', businessName: 'Salon A',
  defaultHref: '/staff/today', description: null, id: 'synthetic-owner-workspace', label: 'Salon A',
  menuActions: [], primaryAction: null, quickActions: [], roleCode: 'OWNER', roleLabel: 'Owner', salonCount: 1,
  salonId: '00000000-0000-4000-8000-000000000002', salonMode: 'manage', salonName: 'Salon A', secondaryAction: null, type: 'salon',
};
const navigation = {
  accountAvatarUrl: null, accountEmail: null, accountLabel: 'Synthetic owner', canManageStaff: true, canSwitchManageSalon: false,
  currentManageSalonId: workspace.salonId, currentManageSalonName: workspace.salonName, currentAccountName: workspace.accountName,
  currentUserId: '00000000-0000-4000-8000-000000000001', currentStaffSalonId: null, currentStaffSalonName: null,
  currentWorkspace: workspace, manageSalons: [], notificationSummary: summary, salonMode: 'manage', staffSalons: [],
  workspaceOptions: [workspace], workspaceSections: [], workspaceType: 'salon',
};
writeFileSync('ios/ReylumiTests/OwnerTodayMeasurementFixture.json', JSON.stringify({ synthetic: true, phases, navigation, summary }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ synthetic: true, phases: Object.keys(phases), output: 'ios/ReylumiTests/OwnerTodayMeasurementFixture.json' }) + '\n');
