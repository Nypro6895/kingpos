import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync('lib/customer-identity-match.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { customerNameKey, customerNameSimilarity, customerPhoneKey } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

test('visually identical accented names have identical keys and a full similarity score', () => {
  for (const name of ['Jos\u00e9', 'Nguy\u1ec5n', 'Tr\u1ea7n', '\uac00']) {
    assert.equal(customerNameKey(name.normalize('NFD')), customerNameKey(name.normalize('NFC')));
    assert.equal(customerNameSimilarity(name.normalize('NFD'), name.normalize('NFC')), 1);
  }
});

test('normalization preserves distinct accents and existing name/phone matching behavior', () => {
  assert.notEqual(customerNameKey('Jos\u00e9'), customerNameKey('Jose'));
  assert.equal(customerNameKey('  ANNA-MARIE  '), 'annamarie');
  assert.equal(customerNameKey(null), '');
  assert.equal(customerNameSimilarity('', ''), 0);
  assert.equal(customerNameSimilarity('Anna', 'AnNa'), 1);
  assert.equal(customerPhoneKey('(971) 373-2876'), '+19713732876');
});
