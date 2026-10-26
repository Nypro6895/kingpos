import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const extensions = ['.tsx', '.ts', '.jsx', '.js'];
const allRoles = ['guest', 'customer', 'owner', 'staff'];
const auth = new Set(['/login', '/signup', '/forgot-password', '/reset-password', '/account-recovery', '/security-check', '/accept-invite']);
const legal = new Set(['/terms', '/privacy', '/community', '/business-terms', '/legal']);
const creation = new Set(['/businesses/create', '/businesses/new', '/salons/new', '/customers/new', '/customers/[customerId]/edit', '/tax-company/install']);
const privateCatalog = new Set(['/account', '/settings', '/salon-settings', '/services', '/staff', '/staff/connections', '/customers', '/customers/[customerId]', '/salon-profile', '/salon-profile/client-transformations', '/beauty', '/businesses', '/salons', '/my-place', '/more', '/permissions', '/roles']);
const live = new Set(['/', '/activity', '/activity/receipts/[ticketId]', '/my-bookings', '/my-bookings/[bookingId]', '/notifications', '/notifications/visits/[visitId]', '/staff/today', '/staff/my-work', '/staff/workday', '/staff/appointments', '/bookings', '/reports', '/payroll', '/payroll/tax-company', '/tax-company', '/tax-company/[salonId]', '/pos-tickets', '/pos-tickets/[ticketId]', '/campaigns', '/support', '/support/[caseId]']);

function classify(route) {
  let classification, roles = allRoles, scope = 'public', renderStrategy = 'prepared-public-page', rendererId = `prepared:${route}`, readResources = [], onlineReason = null;
  if (route === '/local-app') return { classification: 'public-static', roles: allRoles, scope: 'public', renderStrategy: 'local-host', rendererId: 'app-local.host', readResources, onlineReason };
  if (route === '/help' || route === '/help/[slug]') {
    classification = 'public-static'; renderStrategy = 'bundled-content'; rendererId = route === '/help' ? 'help.home' : 'help.guide';
  } else if (legal.has(route)) classification = 'public-static';
  else if (auth.has(route) || /^\/(?:booking-payment|booking\/manage|deletion-status|ownership\/invite|staff\/invite|check-in|visit|claim)(?:\/|$)/.test(route)
    || route.startsWith('/admin') || creation.has(route) || ['/market/payment-return', '/market/orders/[orderId]', '/market/booking-deposit/payment', '/market/booking-deposit/settings', '/settings/login-security', '/settings/recovery-back-office', '/pos/customer-display', '/pos/customer-display/setup', '/support/guest/[threadId]', '/contact-support', '/payroll/tax-company/settings'].includes(route)) {
    classification = 'sensitive-writes'; scope = 'none'; renderStrategy = 'online-only'; rendererId = null;
    roles = route.startsWith('/admin') ? ['admin'] : allRoles;
    onlineReason = route.startsWith('/admin') ? 'Administrative authority and private records require the existing fresh online page.' : 'Credential, token, recovery, creation or sensitive confirmation flow uses its existing online page.';
  } else if (route === '/explore' || route.startsWith('/explore/') && route !== '/explore/favorites') {
    classification = 'business-catalog';
  } else if (route === '/market' || route === '/market/booking-deposit') {
    classification = 'business-catalog'; rendererId = 'market'; readResources = ['market.catalog'];
  } else if (route === '/book/[salonId]') {
    classification = 'business-catalog'; scope = 'viewer'; renderStrategy = 'prepared-authorized-page'; roles = allRoles;
  } else if (/^\/pos(?:\/|$)/.test(route)) {
    classification = route === '/pos/settings' ? 'business-catalog' : 'live'; roles = ['owner', 'portable']; scope = 'workspace'; renderStrategy = 'prepared-authorized-page';
    rendererId = route.startsWith('/pos/portable') ? 'pos.portable' : route === '/pos/check-in' ? 'pos.check-in' : route === '/pos' ? 'pos.checkout' : `prepared:${route}`;
  } else if (route === '/explore/favorites' || route === '/more/[section]') {
    classification = 'live'; roles = ['customer', 'owner', 'staff']; scope = 'viewer'; renderStrategy = 'prepared-authorized-page';
    readResources = route === '/explore/favorites' ? ['customer.favorites'] : ['customer.saved-posts', 'customer.following'];
  } else if (privateCatalog.has(route)) {
    classification = 'business-catalog'; roles = ['customer', 'owner', 'staff']; scope = ['services', 'staff', 'salon-settings', 'salon-profile', 'customers'].some(name => route === '/' + name || route.startsWith('/' + name + '/')) ? 'workspace' : 'viewer';
    renderStrategy = 'prepared-authorized-page'; if (route === '/settings') rendererId = 'settings.hub';
  } else if (live.has(route)) {
    classification = 'live'; roles = ['customer', 'owner', 'staff']; scope = 'workspace'; renderStrategy = 'prepared-authorized-page';
    if (route === '/staff/my-work') { scope = 'staff-binding'; roles = ['staff']; rendererId = 'staff.my-work'; readResources = ['staff.my-work']; }
    if (route === '/staff/workday') { scope = 'staff-binding'; roles = ['staff']; rendererId = 'staff.workday'; readResources = ['staff.workday']; }
    if (route === '/staff/appointments') { scope = 'staff-binding'; roles = ['staff']; rendererId = 'staff.schedule'; readResources = ['staff.schedule']; }
    if (route === '/staff/today') { roles = ['owner']; rendererId = 'owner.today'; readResources = ['owner.today']; }
    if (route === '/activity') { scope = 'viewer'; rendererId = 'customer.activity'; readResources = ['customer.activity']; }
    if (route === '/activity/receipts/[ticketId]') { scope = 'viewer'; readResources = ['customer.history']; }
    if (route === '/my-bookings' || route === '/my-bookings/[bookingId]') { scope = 'viewer'; rendererId = 'customer.bookings'; readResources = ['customer.bookings']; }
  } else throw new Error(`Unclassified app page: ${route}. Add an explicit policy; never silently cache a new route.`);
  return { classification, roles, scope, renderStrategy, rendererId, readResources, onlineReason };
}

async function existingFile(base) {
  for (const suffix of [...extensions, ...extensions.map(extension => '/index' + extension)]) {
    try { await access(base + suffix); return base + suffix; } catch { /* Next candidate. */ }
  }
  return null;
}
function moduleBase(root, importer, specifier) {
  if (specifier.startsWith('@/')) return path.join(root, specifier.slice(2));
  if (specifier.startsWith('.')) return path.resolve(path.dirname(importer), specifier);
  return null;
}
async function inspectPage(root, file) {
  const source = await readFile(file, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = new Map(), clientModules = [];
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.isTypeOnly || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const specifier = node.moduleSpecifier.text, names = [];
    if (node.importClause.name) names.push([node.importClause.name.text, 'default']);
    if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) for (const item of node.importClause.namedBindings.elements) if (!item.isTypeOnly) names.push([item.name.text, item.propertyName?.text ?? item.name.text]);
    names.forEach(([local, exported]) => imports.set(local, { module: specifier, exported }));
    const base = moduleBase(root, file, specifier), target = base && await existingFile(base);
    if (target && /^\s*["']use client["'];?/.test(await readFile(target, 'utf8'))) clientModules.push({ source: path.relative(root, target).replaceAll('\\', '/'), exports: names.map(([, exported]) => exported) });
  }
  const propsLoaders = new Set();
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^(?:get|load|list|require|resolve)/.test(node.expression.text) && imports.has(node.expression.text)) {
      const imported = imports.get(node.expression.text); propsLoaders.add(`${imported.module}#${imported.exported}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { clientModules, propsLoaders: [...propsLoaders].sort() };
}

/** Read the real route tree, including groups/layouts, without importing server modules. */
export async function generateAppLocalInventory(root = process.cwd()) {
  const app = path.join(root, 'app'), pages = [], layouts = [];
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isDirectory() && !item.name.startsWith('_')) await walk(path.join(directory, item.name));
      else if (item.isFile() && /^(?:page|layout)\.[jt]sx?$/.test(item.name)) (item.name.startsWith('page.') ? pages : layouts).push(path.join(directory, item.name));
    }
  }
  await walk(app);
  const routes = [];
  for (const file of pages) {
    const relative = path.relative(app, file).replaceAll('\\', '/');
    const route = '/' + relative.split('/').slice(0, -1).filter(segment => !segment.startsWith('(') && !segment.startsWith('@')).join('/');
    const ancestors = layouts.filter(layout => file.startsWith(path.dirname(layout) + path.sep)).sort((a, b) => a.length - b.length).map(layout => path.relative(root, layout).replaceAll('\\', '/'));
    const policy = classify(route), modules = await inspectPage(root, file);
    routes.push({ route, source: 'app/' + relative, layouts: ancestors, ...policy, ...modules,
      ui: { availability: 'local-module-registration', source: 'app/' + relative, bundledContent: policy.renderStrategy === 'bundled-content', rendererReady: false, note: 'Only the actual client registry can establish a complete local renderer; inventory never reports a generic shell as done.' },
      data: { policy: policy.scope === 'none' ? 'online-only' : policy.scope === 'public' ? 'public-content' : 'scoped-authorized-snapshot', scope: policy.scope, requiresFreshServerAuthorityForWrites: true },
      actions: 'existing-online-confirmation', authority: 'server-validated-context-and-resource-ownership' });
  }
  routes.sort((a, b) => a.route.localeCompare(b.route));
  return { schemaVersion: 1, pageCount: routes.length, layoutCount: layouts.length, routes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.cwd(), result = await generateAppLocalInventory(root), output = path.join(root, 'lib/app-local-route-inventory.generated.json');
  const content = JSON.stringify(result, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (await readFile(output, 'utf8') !== content) throw new Error('App local route inventory is stale. Run generate-app-local-routes.mjs.');
  } else await writeFile(output, content);
  console.log(JSON.stringify({ pages: result.pageCount, layouts: result.layoutCount, checked: process.argv.includes('--check') }));
}
