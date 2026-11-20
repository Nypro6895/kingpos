import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildSync, transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function evaluate(code, localRequire = require) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  return module.exports;
}
function bundle(file) {
  return evaluate(buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text);
}
const policies = bundle('lib/legal-policies.ts');
const configuration = bundle('lib/reylumi-config.ts');
const { legalDocuments, LEGAL_DATES } = policies;
const richText = parts => parts.map(part => typeof part === 'string' ? part : part.text).join('');
const blockText = block => block.type === 'list' ? block.items.map(richText).join('\n') : block.type === 'subheading' ? block.text : richText(block.content);
const section = (document, id) => {
  const value = legalDocuments[document].sections.find(value => value.id === id);
  assert.ok(value, `${document}#${id}`);
  return value.blocks.map(blockText).join('\n');
};

const expectedSections = {
  terms: ['introduction', 'acceptance', 'eligibility', 'accounts-and-roles', 'account-responsibility', 'platform-role', 'user-inputs-outputs', 'booking', 'payments', 'third-party-services', 'prohibited-use', 'intellectual-property', 'ai-generated-images', 'suspension-termination', 'disclaimer', 'limitation-liability', 'changes', 'governing-law', 'contact'],
  privacy: ['introduction', 'information-we-collect', 'how-we-use-information', 'business-staff-data', 'customer-booking-data', 'device-usage-analytics', 'service-providers', 'data-sharing', 'data-security', 'data-retention', 'account-deletion', 'business-records-after-account-deletion', 'privacy-rights', 'cookies-analytics', 'legal-requests', 'changes', 'contact'],
  community: ['purpose', 'authentic-identity', 'respectful-conduct', 'content', 'photos-videos-before-after', 'reviews', 'review-manipulation', 'harassment-threats', 'fraud-scams', 'spam', 'impersonation', 'intellectual-property', 'privacy-of-others', 'enforcement', 'appeals', 'reporting-content'],
  business: ['business-accounts', 'salon-responsibilities', 'owner-responsibilities', 'multiple-owners', 'staff-relationships', 'permissions-access', 'services-availability', 'booking-responsibility', 'pos-records', 'payments', 'payroll', 'tax', 'customer-business-data', 'business-continuity', 'ownership-transfer', 'restricted-historical-data', 'security-access-control', 'suspension-business-disputes', 'contact'],
};

test('the integrated November revision retains the established effective date, routes and section anchors', () => {
  assert.deepEqual(LEGAL_DATES, { effective: 'August 21, 2026', lastUpdated: 'November 18, 2026' });
  assert.equal(legalDocuments.terms.lastUpdated, 'November 18, 2026');
  for (const [key, ids] of Object.entries(expectedSections)) {
    assert.deepEqual(legalDocuments[key].sections.map(value => value.id), ids);
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.deepEqual(Object.values(legalDocuments).map(value => value.href), ['/terms', '/privacy', '/community', '/business-terms']);
});

test('all policy-to-policy section links still resolve to an existing target', () => {
  const routes = new Map(Object.values(legalDocuments).map(document => [document.href, new Set(document.sections.map(section => section.id))]));
  for (const document of Object.values(legalDocuments)) for (const item of document.sections) for (const block of item.blocks) {
    const parts = block.type === 'list' ? block.items.flat() : block.content ?? [];
    for (const part of parts) {
      if (typeof part !== 'object' || part.type !== 'link' || !part.href.includes('#')) continue;
      const [route, id] = part.href.split('#');
      if (routes.has(route)) assert.ok(routes.get(route).has(id), part.href);
    }
  }
});

test('private financial collection is disclosed independently from provider card entry', () => {
  const text = section('privacy', 'information-we-collect');
  assert.match(text, /salon may supply a customer or staff record even if that person has not created/i);
  assert.match(text, /Social Security numbers, EINs/);
  assert.match(text, /authorized server workflow can decrypt bank details/);
  assert.match(text, /payment provider may collect card or billing information/i);
  assert.match(text, /does not mean ReyLUMI collects no financial information/);
  assert.match(text, /bank details.*separate Check Writer workflow/);
});

test('device storage, manual diagnostics and linked server security logs have distinct boundaries', () => {
  const technical = section('privacy', 'device-usage-analytics');
  const collection = section('privacy', 'information-we-collect');
  assert.match(technical, /authorized read models and queued workspace operations/);
  assert.match(technical, /caption, and uploaded file references/);
  assert.match(technical, /rather than automatically uploading that report/);
  assert.match(technical, /server-side security or troubleshooting records are handled separately/);
  assert.match(collection, /link an account or action with an IP address, user agent/);
  assert.match(collection, /signed or hashed browser identifier/);
});

test('new account/salon export access is distinguished from legacy links and physical removal', () => {
  const text = section('privacy', 'data-retention');
  assert.match(text, /account and salon exports created under the seven-day export controls/);
  assert.match(text, /15 minutes, capped by the remaining export access period/);
  assert.match(text, /permission change alone does not recall a valid bearer link/);
  assert.match(text, /physical deletion is not guaranteed at the exact access deadline/);
  assert.match(text, /do not automatically revoke or purge every historical copy/);
  assert.match(text, /Downloaded or printed copies are not removed/);
});

test('privacy requests are not limited to profile deletion or the account pending period', () => {
  assert.match(section('privacy', 'account-deletion'), /without waiting for that period to end/);
  assert.match(section('privacy', 'account-deletion'), /not an extension of a deadline imposed by applicable privacy law/);
  assert.match(section('privacy', 'business-records-after-account-deletion'), /private support messages/);
  assert.match(section('privacy', 'business-records-after-account-deletion'), /not limited to the personal-profile deletion control/);
  assert.match(section('privacy', 'privacy-rights'), /Where applicable.*opting out of a sale or sharing/s);
  assert.match(section('privacy', 'privacy-rights'), /without unlawful discrimination/);
  assert.doesNotMatch(section('privacy', 'account-deletion'), /(?:normally completes|will be deleted|guaranteed).*24 hours/i);
});

test('assent is not blanket privacy consent; duties do not waive platform responsibility or UGC ownership', () => {
  assert.match(section('terms', 'acceptance'), /not blanket consent/);
  assert.match(section('terms', 'acceptance'), /Displaying this policy alone does not establish/);
  const ip = section('terms', 'intellectual-property');
  assert.match(ip, /does not transfer ownership to ReyLUMI/);
  assert.match(ip, /non-exclusive, royalty-free license/);
  assert.match(ip, /does not make private workspace records, payroll information, tax documents, or drafts public/);
  assert.match(ip, /does not grant permission for unrelated public promotion, sale, or AI-model training/);
  assert.match(ip, /do not.*prevent lawful criticism/);
  assert.match(section('terms', 'user-inputs-outputs'), /do not remove ReyLUMI's obligations for its own calculations/);
  assert.match(section('privacy', 'data-security'), /do not transfer ReyLUMI's own security or privacy obligations/);
});

test('free download and advertising purchases do not introduce a universal refund or age policy', () => {
  const payments = section('terms', 'payments');
  assert.match(payments, /paid Market feature, subscription, sponsored placement, or advertising-credit purchase where offered/);
  assert.match(payments, /do not remove a refund or cancellation right/);
  assert.doesNotMatch(payments, /all sales are final|non-refundable|guaranteed (?:cash )?refund|credits expire/i);
  assert.match(payments, /Support reviews refund requests individually under the terms of the actual purchase and applicable law/);
  assert.match(payments, /returns eligible unused campaign credits to the advertising balance; it does not automatically refund a payment to a card or other payment method/);
  assert.match(payments, /return of credits to the balance and a cash refund are separate outcomes/);
  assert.match(payments, /does not restrict a refund right protected by applicable law/);
  assert.match(section('terms', 'eligibility'), /do not set a universal minimum age/);
  assert.match(section('privacy', 'privacy-rights'), /children under 13 or has actual knowledge/);
  assert.match(section('privacy', 'information-we-collect'), /decline device location access.*manual city, ZIP, or address search/s);
});

test('provider-neutral candidate does not invent geographic, training, retention or DMCA assurances', () => {
  const text = Object.values(legalDocuments).flatMap(document => document.sections.flatMap(section => section.blocks.map(blockText))).join('\n');
  assert.doesNotMatch(text, /all (?:data|records).*stored (?:only|exclusively) in the (?:US|United States)|never used by.*training|registered DMCA agent|guaranteed.*safe harbor|all records.*deleted.*seven days/i);
  assert.match(section('privacy', 'service-providers'), /role depends on the service and its use of information/);
  assert.match(section('privacy', 'cookies-analytics'), /not.*automatically anonymous/);
});

test('the actual legal page renderer renders every updated policy and anchor without remote requests', () => {
  const code = transformSync(readFileSync('app/legal/legal-components.tsx', 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
  const renderer = evaluate(code, name => {
    if (name === '@/lib/legal-policies') return policies;
    if (name === '@/lib/reylumi-config') return configuration;
    if (name === 'next/link') return function LegalTestLink(props) { return React.createElement('a', props); };
    if (name === '@/app/legal/legal-table-of-contents') return { LegalTableOfContentsClient: () => null };
    return require(name);
  });
  for (const document of Object.values(legalDocuments)) {
    const html = renderToStaticMarkup(React.createElement(renderer.LegalDocumentPage, { document }));
    assert.match(html, /Effective date:/);
    assert.match(html, /August 21, 2026/);
    for (const item of document.sections) assert.ok(html.includes(`id="${item.id}"`), `${document.href}#${item.id}`);
  }
});
