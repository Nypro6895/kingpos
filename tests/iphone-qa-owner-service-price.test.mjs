import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('app/pos/owner-pos-client.tsx', 'utf8');
const tree = ts.createSourceFile('owner-pos-client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const workspace = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'OwnerPosWorkspace');
const declaration = workspace.body.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
  .find(node => node.name.getText(tree) === 'chooseService');
assert.ok(declaration?.initializer, 'the production service-selection callback exists');
const callback = ts.transpileModule(`module.exports = (${declaration.initializer.getText(tree)});`, {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
}).outputText;

function loadHelpers(path) {
  const module = {exports: {}};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
  }).outputText, {module, exports: module.exports});
  return module.exports;
}
const {serviceDefaultAmount} = loadHelpers('lib/pos-service-catalog.ts');

/** Actual production callback and default-price helper; no React, storage or transport runs here. */
function choose({amount = '', editing = true, line = null, id = 'gel', staff = true} = {}) {
  const cart = {amount, lines: line ? [line] : []};
  const module = {exports: {}};
  const state = {patch: null, panel: undefined};
  const editingField = {current: editing};
  const replaceAmount = {current: false};
  vm.runInNewContext(callback, {
    module,
    reference: {services: [{id: 'gel', name: 'Gel Manicure', base_price: '35.00'}, {id: 'pedicure', name: 'Pedicure', base_price: 40}]},
    cart, selectedLine: line, editingField, replaceAmount, hasStaff: staff,
    serviceDefaultAmount,
    update: patch => {state.patch = JSON.parse(JSON.stringify(patch));},
    setPickerQuery() {}, setPanel: panel => {state.panel = panel;},
  });
  module.exports(id);
  return {...state, editing: editingField.current, replaceAmount: replaceAmount.current};
}

test('Owner POS: selecting a priced service from the untouched current-entry field initializes its amount', () => {
  const result = choose();
  assert.equal(result.patch.serviceId, 'gel');
  assert.equal(result.patch.amount, '35');
  assert.equal(result.panel, null, 'editing the field retains the existing picker sequence');
  assert.equal(result.editing, false);
  assert.equal(result.replaceAmount, true, 'the first numeric key can replace the suggested price');
});

for (const amount of ['45', '40/5', '45/', '0']) {
  test(`Owner POS: changing the service preserves manually entered current amount ${JSON.stringify(amount)}`, () => {
    assert.equal(choose({amount}).patch.amount, amount);
  });
}

test('Owner POS: Add-service selection still applies the catalog price and advances to staff', () => {
  const result = choose({editing: false});
  assert.equal(result.patch.amount, '35');
  assert.equal(result.panel, 'staff');
});

test('Owner POS: changing an existing receipt line preserves its entered amount and staff', () => {
  const line = {id: 'draft-line', serviceId: 'gel', serviceLabel: 'Gel Manicure', staffId: 'staff', staffName: 'QA', total: 45, amountInput: '40/5', amountParts: [40, 5]};
  const result = choose({line, id: 'pedicure'});
  assert.deepEqual(result.patch.lines, [{...line, serviceId: 'pedicure', serviceLabel: 'Pedicure'}]);
  assert.equal(Object.hasOwn(result.patch, 'amount'), false);
});

test('Owner POS: amount-only selection keeps a blank new entry blank', () => {
  assert.equal(choose({id: null}).patch.amount, '');
});
