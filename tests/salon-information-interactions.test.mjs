import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function loadComponent(path, overrides = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => {
    if (name in overrides) return overrides[name];
    if (name === '@/components/workspace-language') return {
      WorkspaceText: ({ text }) => text,
      useWorkspaceTranslation: () => value => value,
    };
    if (name === 'next/link') return { default: ({ children, ...props }) => React.createElement('a', props, children) };
    return require(name);
  } });
  return module.exports;
}
const trust = loadComponent('components/reylumi-trust.tsx');
const summary = {
  level: 'empty', evidenceRows: [],
  mark: { label: 'Building LUMI Trust', ariaLabel: 'Building LUMI Trust', detail: 'Building evidence' },
};
test('an unranked salon still exposes a named, keyboard accessible trust popup trigger', () => {
  const html = renderToStaticMarkup(React.createElement(trust.LumiTrustPopover, {
    summary, presentation: 'spark', triggerLabel: 'Building LUMI Truth', entityName: 'King Nails',
  }));
  assert.match(html, /<button/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /Building LUMI Truth<\/span>/);
  assert.doesNotMatch(html, /<svg/);
  assert.doesNotMatch(html, /<div/);
});
test('trust text and visit counts expose separate popup and profile navigation', () => {
  const { SalonTrustLine } = loadComponent('components/salon-trust-line.tsx', {
    '@/components/reylumi-trust': trust,
    '@/components/reylumi-icons': { ReylumiIcon: () => null },
    '@/lib/reylumi-trust': { buildReylumiTrustSummary: () => summary },
  });
  const html = renderToStaticMarkup(React.createElement(SalonTrustLine, {
    signals: { trustEvidence: { verifiedVisitCount: 0, feedbackCustomerCount: 0 } },
    href: '/explore/salons/king', name: 'King Nails',
  }));
  assert.match(html, /Building LUMI Truth<\/span>/);
  assert.match(html, /href="\/explore\/salons\/king#lumi-trust"/);
  assert.match(html, /href="\/explore\/salons\/king#customer-experiences"/);
  assert.doesNotMatch(html, /<div/);
});
test('operating status is interactive only with a known salon and does not load hours during render', () => {
  const { SalonOperatingStatusBadge } = loadComponent('components/salon-operating-status-badge.tsx', {
    '@/app/salon-profile/operating-hours-display': { OperatingHoursDisplay: () => { throw new Error('Hours must load only after opening'); } },
  });
  const status = { label: 'Open now', detail: 'Closes at 7 PM', isOpen: true };
  const html = renderToStaticMarkup(React.createElement(SalonOperatingStatusBadge, { status, salonId: 'king', showDetail: true }));
  assert.match(html, /<button/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /Closes at 7 PM/);
  const preview = renderToStaticMarkup(React.createElement(SalonOperatingStatusBadge, { status }));
  assert.doesNotMatch(preview, /<button/);
});
