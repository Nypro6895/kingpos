import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

let hidden = [];
const empty = () => null;
const anchor = ({ children, prefetch, ...props }) => React.createElement('a', props, children);
const picture = ({ fill, priority, onError, ...props }) => React.createElement('img', { ...props, style: fill ? { position: 'absolute', width: '100%', height: '100%', inset: 0 } : undefined });
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  let source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('explore-client.tsx')) source += '\nexport { DesktopLooksNearYouSection, DesktopTopSalonsNearYouSection, DesktopAvailableTodaySection, DesktopDiscoveryMarketplace };';
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, console, URLSearchParams, process: { env: {} },
    require(name) {
      if (name === 'react') return { ...React, useState: value => React.useState(value === 1 ? 6 : value) };
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'next/link') return { default: anchor };
      if (name === 'next/image') return { default: picture };
      if (name === 'next/dynamic') return { default: () => empty };
      if (name.includes('explore-viewport-image')) return { ExploreViewportImage: picture };
      if (name === '@/components/post-safety') return { useHiddenPosts: () => hidden, postIdentity: target => `${target.sourceType}:${target.sourceId}` };
      if (name === '@/components/post-identity') return { PostIdentity: ({ salonName, salonHref }) => React.createElement('a', { href: salonHref }, salonName) };
      if (name === '@/components/explore-account-actions') return { ExploreSalonLove: empty, ExploreBookButton: ({ href, contactHref }) => React.createElement('a', { href: href || contactHref }, href ? 'Book' : 'Contact salon') };
      if (name === '@/lib/reylumi-trust') return { buildReylumiTrustSummary: () => ({ qualityScore: null }), compareReylumiTrustedSalons: () => 0 };
      if (/^@\/lib\/(explore-editorial|default-nail-images|nail-inspiration|nail-inspiration-catalog|explore-entry-presentation)$/.test(name)) return load(name.replace('@/', '') + '.ts');
      if (name === './explore-editorial') return load('app/explore/explore-editorial.tsx');
      return new Proxy({}, { get: () => empty });
    },
  }, { filename: file });
  return exports;
}
const helpers = load('lib/explore-editorial.ts');
const ui = load('app/explore/explore-client.tsx');
const render = (name, props) => renderToStaticMarkup(React.createElement(ui[name], props));
const location = 'Milwaukee, WI';
const salon = { id: '00000000-0000-4000-8000-000000000001', name: 'A real local salon', hasPublicProfile: true, serviceCategories: ['Nails'], serviceNames: [], city: 'Milwaukee', state: 'WI', coverImageUrl: '/images/nail-defaults/nails-01.webp', phone: '4145550123', logoImageUrl: null, operatingStatus: { isOpen: false }, bookingEnabled: false, bookingHref: null, averageRating: null, startingPrice: null, homeRank: 1, homeSection: 'recommended' };
const look = { mediaId: 'one', contentId: 'one', contentType: 'look', imageUrl: '/inspiration/nails/cherry-stiletto.webp', salonId: salon.id, salonName: salon.name, salonHref: `/explore/salons/${salon.id}`, salonCity: salon.city, salonState: salon.state, serviceCategory: 'Nails', serviceName: 'Nail art', bookingEnabled: false, saveTarget: { saved: false, saveCount: 0 }, trust: {}, bookingMeta: { price: null, durationMinutes: null, distanceMiles: null, availabilityLabel: null }, operatingStatus: { isOpen: false } };
const lookProps = { looks: [look], mapSalons: [], category: 'Nails', location, onExplore: empty, userCoordinates: null };

test('references fill only missing slots, exclude existing images and use real bundled assets', () => {
  assert.equal(helpers.exploreEditorialReferences('Nails', location, 0).length, 0);
  const references = helpers.exploreEditorialReferences('Nails', location, 3, [look.imageUrl]);
  assert.equal(references.length, 3);
  assert.equal(new Set(references.map(row => row.imageUrl)).size, 3);
  for (const row of references) {
    assert.notEqual(row.imageUrl, look.imageUrl);
    assert.ok(fs.existsSync(path.join('public', row.imageUrl)));
    const url = new URL(row.href, 'https://reylumi.com');
    assert.equal(url.searchParams.get('location'), location);
    assert.equal(url.searchParams.get('category'), 'Nails');
    assert.ok(url.searchParams.get('q'));
  }
});

test('non-nail and unknown categories retain their category and location without claiming local work', () => {
  for (const category of ['Hair', 'Lashes', 'Massage', 'Tattoo', 'Brows', 'Waxing', 'Skin Care', 'Pedicure']) {
    const references = helpers.exploreEditorialReferences(category, 'Mary Esther, FL', 3);
    assert.ok(references.length);
    for (const row of references) {
      const url = new URL(row.href, 'https://reylumi.com');
      assert.equal(url.searchParams.get('category'), category);
      assert.equal(url.searchParams.get('location'), 'Mary Esther, FL');
      assert.equal(row.kind, 'guide');
      assert.doesNotMatch(row.imageUrl, /inspiration\/nails/);
      if (row.imageUrl) assert.ok(fs.existsSync(path.join('public', row.imageUrl)));
    }
  }
});

test('fresh looks deduplicates public photos and fills spare cards with labeled inspiration', () => {
  const html = render('DesktopLooksNearYouSection', { ...lookProps, looks: [look, { ...look, mediaId: 'duplicate' }] });
  assert.equal((html.match(/<article/g) || []).length, 3);
  assert.equal((html.match(/data-editorial-reference="inspiration"/g) || []).length, 2);
  assert.match(html, /Fresh looks/);
  assert.match(html, /Not a salon/);
  assert.match(html, /A real local salon/);
  assert.match(html, /Milwaukee · WI/);
  assert.doesNotMatch(html, /Â|Ã|â†/);
  assert.doesNotMatch(html, /No matching looks|0 visited|0 opinions|available today/i);
  hidden = ['salon_profile_look:one'];
  try {
    const hiddenHtml = render('DesktopLooksNearYouSection', lookProps);
    assert.doesNotMatch(hiddenHtml, /A real local salon/);
    assert.equal((hiddenHtml.match(/data-editorial-reference="inspiration"/g) || []).length, 3);
  } finally { hidden = []; }
});

test('real salons without ratings remain discoverable and lack of a calendar becomes contact options', () => {
  const recommended = render('DesktopTopSalonsNearYouSection', { salons: [salon], postHrefBySalonId: new Map(), category: 'Nails', location });
  assert.match(recommended, /Recommended for you|A real local salon/);
  assert.doesNotMatch(recommended, /Top salons|No top salons|#1/);
  const booking = render('DesktopAvailableTodaySection', { salons: [], contactSalons: [salon], postHrefBySalonId: new Map(), category: 'Nails', location });
  assert.match(booking, /Plan your next visit/);
  assert.match(booking, /tel:4145550123/);
  assert.match(booking, /Contact the salon to confirm/);
  assert.doesNotMatch(booking, /No booking options|available today|>Book</i);
});

test('empty booking data becomes category-specific guides and the assembled marketplace has no detached shortcut cards', () => {
  const booking = render('DesktopAvailableTodaySection', { salons: [], contactSalons: [], postHrefBySalonId: new Map(), category: 'Hair', location });
  assert.match(booking, /service guides|A fresh cut/);
  assert.doesNotMatch(booking, /No booking options|category=Nails/);
  const marketplace = render('DesktopDiscoveryMarketplace', { activeResults: [], discoveryShortcuts: [], onDiscoveryShortcutSelect: empty, commentViewer: {}, content: { inspiration: { items: [look] }, recommendedSalons: [salon], newSalons: [], popularServices: [] }, gpsCoordinates: null, location, nearYouSalons: [], onApplySearchShortcut: empty, onSelectCategory: empty, selectedCategory: 'Nails', strictLocation: true });
  assert.match(marketplace, /Fresh looks/);
  assert.match(marketplace, /Recommended for you/);
  assert.match(marketplace, /A real local salon/);
  assert.doesNotMatch(marketplace, /data-discovery-shortcut=|No top salons|No booking options|Fresh styles/);
});

export { render, salon, look, lookProps, location };

