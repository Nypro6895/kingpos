import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const ownerPath = 'app/pos/owner-pos-client.tsx';
const draftsPath = 'app/pos/portable/portable-draft-controls.tsx';
const clone = value => JSON.parse(JSON.stringify(value));

function hookSlots(source, functionName) {
  const tree = ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === functionName)?.body;
  if (!body) throw new Error(`Missing actual function ${functionName}`);
  const result = { useState: [], useRef: [] };
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!call || !ts.isCallExpression(call)) continue;
      const hook = call.expression.getText(tree);
      if (!(hook in result)) continue;
      const name = ts.isArrayBindingPattern(declaration.name) ? declaration.name.elements[0].getText(tree) : declaration.name.getText(tree);
      result[hook].push(name);
    }
  }
  return result;
}

function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

function textOf(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  if (Array.isArray(tree)) return tree.map(textOf).join('');
  return tree.props?.text ?? textOf(tree.props?.children);
}

/**
 * Executes the unchanged production TSX callbacks in an isolated VM. React's
 * state/ref containers are synchronous here; effects, DOM and remote adapters
 * are inert. It does not claim browser/React scheduling or device acceptance.
 */
export function createPosDraftSubmitHarness({ sourceRoot = resolve('.'), branch = 'queue', existingOperation = false, cartOverrides = {} } = {}) {
  const source = Object.fromEntries([ownerPath, draftsPath].map(path => [path, readFileSync(resolve(sourceRoot, path), 'utf8')]));
  const slots = { owner: hookSlots(source[ownerPath], 'OwnerPosWorkspace'), drafts: hookSlots(source[draftsPath], 'PortableDraftControls') };
  const cartA = { id: 'fixture-cart-A', amount: '10', staffId: 'fixture-staff', serviceId: 'fixture-service', customer: null, lines: [], tip: '', discount: '', ...cartOverrides };
  const cartB = { ...cartA, id: 'fixture-cart-B', amount: '25' };
  const savedB = { id: 'fixture-saved-B', at: 1, label: 'Draft B', value: cartB };
  const scope = 'owner:fixture', cartKey = `kingpos:owner-cart:v1:${scope}`, savedKey = `kingpos:parked-tickets:v1:${scope}`;
  const memory = new Map([[cartKey, JSON.stringify({ savedAt: 1, cart: cartA })], [savedKey, JSON.stringify([savedB])]]);
  const writes = [], attempts = [], queued = existingOperation ? [{ payload: { ownerCartId: cartA.id } }] : [];
  const deliveries = [], actions = [];
  let nextId = 0, frame;
  const storage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); writes.push({ key, value: JSON.parse(value) }); },
  };
  const beginAttempt = kind => {
    let release, fail;
    const promise = new Promise((resolve, reject) => { release = resolve; fail = reject; });
    attempts.push({ kind, release, fail });
    return promise;
  };
  const preferences = { showServices: false, showStaff: false, showCustomer: true, showTip: true, showDiscount: true, idleMinutes: 3, warningSeconds: 60 };
  const rewardView = branch === 'reward' ? { request: { status: 'confirmed', valueCents: 0, quote: {} } } : null;
  const engines = {
    owner: { states: [], refs: [], stateOverrides: { cart: cartA, rewardView }, refOverrides: { current: cartA, giftCheckout: () => branch === 'gift' ? beginAttempt('gift') : Promise.resolve(null) } },
    drafts: { states: [], refs: [], stateOverrides: { saved: [savedB] }, refOverrides: {} },
  };
  function beginRender(kind) { frame = engines[kind]; frame.slots = slots[kind]; frame.stateIndex = 0; frame.refIndex = 0; }
  const react = {
    useState(initial) {
      const engine = frame, index = engine.stateIndex++, name = engine.slots.useState[index];
      if (!(index in engine.states)) engine.states[index] = Object.hasOwn(engine.stateOverrides, name) ? engine.stateOverrides[name] : typeof initial === 'function' ? initial() : initial;
      return [engine.states[index], next => { engine.states[index] = typeof next === 'function' ? next(engine.states[index]) : next; }];
    },
    useRef(initial) {
      const engine = frame, index = engine.refIndex++, name = engine.slots.useRef[index];
      if (!(index in engine.refs)) engine.refs[index] = { current: Object.hasOwn(engine.refOverrides, name) ? engine.refOverrides[name] : initial };
      return engine.refs[index];
    },
    useEffect() {}, useLayoutEffect() {}, useCallback: callback => callback, useMemo: callback => callback(), Activity: 'Activity',
  };
  const jsx = { jsx: (type, props) => ({ type, props: props ?? {} }), jsxs: (type, props) => ({ type, props: props ?? {} }), Fragment: 'Fragment' };
  const inert = () => undefined;
  const utility = new Proxy({}, { get: (_, name) => {
    if (name === 'useWorkspaceTranslation') return () => value => value;
    if (name === 'DEFAULT_WORKSPACE_PREFERENCES') return preferences;
    if (name === 'useOwnerLocalWorkspace') return () => null;
    if (name === 'appLocalRequestId') return () => `fixture-fresh-${++nextId}`;
    if (name === 'parsePosAmountInput') return value => ({ isValid: Boolean(value) && Number(value) > 0, total: Number(value), parts: [Number(value)], error: 'Fixture invalid amount' });
    if (name === 'listPortableOperations') return async () => { await beginAttempt('queue'); return queued; };
    if (name === 'savePortableOperation') return async (ownerScope, type, payload) => { queued.push({ ownerScope, type, payload }); };
    if (name === 'portableDeviceStorage') return storage;
    return inert;
  } });
  function load(path, exportPrivate = false) {
    // Append an export only; no production callback body is extracted/rebuilt.
    const contents = source[path] + (exportPrivate ? '\nexport { OwnerPosWorkspace };\n' : '');
    const compiled = ts.transpileModule(contents, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
    const module = { exports: {} };
    vm.runInNewContext(compiled.outputText, {
      module, exports: module.exports,
      require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? jsx : name === 'react-dom' ? { createPortal: node => node } : name.endsWith('.css') ? {} : utility,
      localStorage: storage, crypto: { randomUUID: () => `fixture-uuid-${++nextId}` }, document: { body: {} }, navigator: { onLine: true },
      fetch: async (url, init) => { if (branch !== 'reward' || url !== '/api/rewards') throw Error('Remote access is disabled in this fixture'); actions.push({ url, body: JSON.parse(init.body) }); await beginAttempt('reward'); return { ok: true, json: async () => ({ ticketId: 'fixture-ticket-A' }) }; },
      console, Error, setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams,
    }, { filename: path });
    return module.exports;
  }
  const owner = load(ownerPath, true), drafts = load(draftsPath);
  const props = { scope, salonId: 'fixture-salon', salonName: 'Fixture salon', initial: { staff: [{id:"fixture-staff",display_name:"Staff",today_status:"working"}], services: [{id:"fixture-service",name:"Manicure"}], defaults: { staffCheckInEnabled: false }, today: '2026-11-03' }, preferences };
  function renderOwner() { beginRender('owner'); return owner.OwnerPosWorkspace(props); }
  function draftProps() { return elements(renderOwner()).find(node => typeof node.props?.restore === 'function' && node.props.scope === scope).props; }
  function renderDrafts() { const props = draftProps(); beginRender('drafts'); return drafts.PortableDraftControls(props); }
  function click(button, { force = false } = {}) { if (!button) throw Error('Expected production button was not rendered'); if (button.props.disabled && !force) return false; button.props.onClick(); return true; }
  function control(label, tree = renderDrafts()) { return elements(tree).find(node => node.type === 'button' && textOf(node) === label); }
  function launcher() { return elements(renderDrafts()).find(node => node.props?.['data-pos-saved-launcher'] !== undefined); }
  function openSaved(options) { if(launcher().props.disabled&&!options?.force)return false; if(elements(renderDrafts()).some(n=>n.props?.['aria-label']==='Saved tickets'))return true; return click(launcher(), options); }
  function selectSaved(options) { return click(elements(renderDrafts()).find(node => node.type === 'button' && textOf(node).startsWith('Draft B')), options); }
  function confirmTakeover(options) {
    const dialog = elements(renderDrafts()).find(node => node.props?.['aria-label'] === 'Open saved ticket');
    return click(control('Reset', dialog), options);
  }
  function state(name) { return engines.owner.states[slots.owner.useState.indexOf(name)]; }
  const result = {
    cartA, cartB, cartKey, savedKey, attempts, queued, actions, writes, deliveries,
    provenance: { ownerPath, draftsPath, sourceSha256: Object.fromEntries(Object.entries(source).map(([path, contents]) => [path, createHash('sha256').update(contents).digest('hex')])), hookSlots: slots,
      boundary: 'Actual production TSX callback bodies; synchronous state/ref fixture; effects/DOM/transports are inert; synthetic data in memory only.' },
    submit(options) { return click(control('Submit', renderOwner()), options); },
    openSaved, selectSaved, confirmTakeover,
    captureTakeoverHandler() {
      const dialog = elements(renderDrafts()).find(node => node.props?.['aria-label'] === 'Open saved ticket');
      const button = control('Reset', dialog);
      if (!button) throw Error('Saved-ticket takeover confirmation is not open');
      return button.props.onClick;
    },
    takeoverSaved(options) {
      if (!openSaved(options) || !selectSaved(options)) return false;
      return elements(renderDrafts()).some(node => node.props?.['aria-label'] === 'Open saved ticket') ? confirmTakeover(options) : true;
    },
    park(options) { if (!control('Save for later')) openSaved({force:true}); return click(control('Save for later'), options); },
    restoreDirect(value = cartB) { return draftProps().restore(value); },
    controls() {
      const tree = renderDrafts(), dialog = elements(tree).find(node => node.props?.['aria-label'] === 'Open saved ticket');
      return { savedDisabled: Boolean(launcher().props.disabled), parkDisabled: Boolean(control('Save for later', tree)?.props.disabled ?? draftProps().disabled), takeoverDisabled: Boolean(control('Reset', dialog)?.props.disabled) };
    },
    async flush() { for (let index = 0; index < 30; index++) await Promise.resolve(); },
    releaseSuccess(index = attempts.length - 1) { const attempt = attempts[index]; if (!attempt) throw Error('No pending fixture attempt'); attempt.release(attempt.kind === 'gift' ? { ticketId: 'fixture-ticket-A' } : undefined); },
    releaseFailure(index = attempts.length - 1) { attempts[index].fail(new Error('Fixture submission failed')); },
    injectDifferentCurrentCart() {
      // Exercise the late-reply fence independently of the public busy guard.
      // This controlled state injection is not a claim that UI bypasses it.
      const index = slots.owner.useState.indexOf('cart'), ref = slots.owner.useRef.indexOf('current');
      engines.owner.states[index] = cartB; engines.owner.refs[ref].current = cartB;
      storage.setItem(cartKey, JSON.stringify({ savedAt: Date.now(), cart: cartB }));
    },
    snapshot() { return clone({ activeCart: JSON.parse(memory.get(cartKey)).cart, savedTickets: JSON.parse(memory.get(savedKey)), busy: state('busy'), error: state('error'), draftsError: engines.drafts.states[slots.drafts.useState.indexOf('error')] ?? '', attempts: attempts.map(({ kind }) => ({ kind })), queued, actions, writes }); },
  };
  renderOwner();
  return result;
}
