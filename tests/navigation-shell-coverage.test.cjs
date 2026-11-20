const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
function loadPolicy(shellSource = fs.readFileSync('app/navigation-shell.tsx', 'utf8'), roleSource = fs.readFileSync('app/role-navigation.ts', 'utf8')) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(roleSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, require });
  const context = { ...module.exports };
  vm.createContext(context);
  const ast = ts.createSourceFile('shell.tsx', shellSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const name of ['matchesPath', 'isShelllessPath', 'isSharedContextRoute', 'getRouteWorkspaceKind', 'routeNavigationForWorkspaceKind']) {
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `Missing shell policy function ${name}`);
    vm.runInContext(ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  }
  return context;
}
function inventory(policy = loadPolicy()) {
  return fs.readdirSync('app', { recursive: true }).filter(file => /(^|[\\/])page\.(?:tsx|ts|jsx|js)$/.test(file)).map(file => {
    file = file.replaceAll('\\', '/');
    const route = '/' + file.split('/').slice(0, -1).filter(segment => !/^\(.*\)$/.test(segment)).join('/');
    let exception = null;
    if (file.startsWith('(legal)/')) exception = 'Public/legal header and legal footer';
    else if (file.startsWith('(market-private)/')) exception = 'Private Market workspace masthead';
    else if (/^\/(?:booking-payment|check-in|visit)(?:\/|$)/.test(route)) exception = 'Public token/payment/check-in flow with dedicated layout';
    else if (policy.isShelllessPath(route)) exception = /^\/admin(?:\/|$)/.test(route) ? 'AdminShell header and own navigation' : /^\/pos\//.test(route) ? 'Dedicated POS/device/customer display shell' : /^\/(?:book|booking)(?:\/|$)/.test(route) ? 'Public booking shell' : 'Authentication screen';
    else if (route === '/pos' || /^\/pos\/(?:ticket|book|check-in|report|settings|more)(?:\/|$)/.test(route)) exception = 'Owner POS frame replaces standard bottom navigation';
    return { file: 'app/' + file, route, exception, kind: policy.getRouteWorkspaceKind(route) };
  });
}
const roles = { personal: { salonMode: null, workspaceType: 'personal' }, owner: { salonMode: 'manage', workspaceType: 'salon' }, staff: { salonMode: 'staff', workspaceType: 'salon' } };
test('every page has common navigation or an explicit dedicated layout', () => {
  const policy = loadPolicy();
  const rows = inventory(policy);
  assert.ok(rows.length > 100, 'Inventory must enumerate the full application');
  for (const row of rows) {
    if (row.exception) continue;
    assert.ok(row.kind, `Unclassified page loses header/bottom: ${row.file}`);
    for (const [role, context] of Object.entries(roles)) {
      if (row.kind === 'salon' && role === 'personal') continue; // requireSalonWorkspacePageContext redirects.
      assert.ok(policy.routeNavigationForWorkspaceKind({ routeWorkspaceKind: row.kind, ...context }), `${row.route} missing navigation in ${role} context`);
    }
  }
});
test('personal plugins, owner plugins and nested routes keep their intended roles', () => {
  const policy = loadPolicy();
  for (const path of ['/gift-cards', '/gift-cards/claim', '/rewards', '/tax-company', '/tax-company/install', '/tax-company/example']) assert.equal(policy.getRouteWorkspaceKind(path), 'personal', path);
  for (const path of ['/gift-cards/manage', '/gift-cards/manage/history', '/reward-system', '/check-writer', '/staff/today']) assert.equal(policy.getRouteWorkspaceKind(path), 'manage', path);
  for (const path of ['/staff/appointments', '/staff/my-work', '/staff/workday', '/staff/scan']) assert.equal(policy.getRouteWorkspaceKind(path), 'staff', path);
  assert.equal(policy.getRouteWorkspaceKind('/staff/connections'), 'personal');
});
test('shared pages and invitations retain the selected role', () => {
  const policy = loadPolicy();
  for (const path of ['/', '/help', '/settings', '/security-check', '/welcome/phone', '/ownership/invite/example', '/staff/invite/example', '/accept-invite']) {
    assert.equal(policy.getRouteWorkspaceKind(path), 'shared', path);
    for (const [role, context] of Object.entries(roles)) assert.equal(policy.routeNavigationForWorkspaceKind({ routeWorkspaceKind: 'shared', ...context }).kind, role);
  }
});
test('every role menu destination has a shell policy', () => {
  const policy = loadPolicy();
  for (const role of Object.keys(roles)) {
    for (const link of [...policy.ROLE_NAVIGATION[role].links, ...policy.ROLE_NAVIGATION[role].moreLinks]) {
      const pathname = new URL(link.href, 'https://reylumi.invalid').pathname;
      assert.ok(policy.getRouteWorkspaceKind(pathname), `${role} menu destination ${link.href} loses the common shell`);
    }
  }
});
test('prefix boundaries do not classify unrelated pages or remove dedicated layouts', () => {
  const policy = loadPolicy();
  for (const path of ['/gift-cards-other', '/reward-system-other', '/check-writer-other', '/rewards-other', '/tax-company-other']) assert.equal(policy.getRouteWorkspaceKind(path), null, path);
  for (const path of ['/admin', '/admin/users', '/pos/portable', '/pos/portable/book', '/pos/customer-display', '/book/example', '/booking/manage/example', '/login', '/signup']) assert.equal(policy.isShelllessPath(path), true, path);
});
module.exports = { loadPolicy, inventory, roles };
