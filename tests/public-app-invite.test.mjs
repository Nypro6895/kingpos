import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, URL, Date, process: { env: {} } });
  return exports;
}

const invite = load('lib/public-app-invite.ts');
const { publicAppInviteConfig, REYLUMI_IOS_APP_ID, REYLUMI_ANDROID_APP_ID } = load('lib/public-app-invite-config.ts');
const entry = '00000000-0000-4000-8000-000000000100';
const token = '0123456789abcdef'.repeat(4);
const iosStore = `https://apps.apple.com/us/app/reylumi/id${REYLUMI_IOS_APP_ID}`;
const androidStore = `https://play.google.com/store/apps/details?id=${REYLUMI_ANDROID_APP_ID}`;
const config = (extra = {}) => publicAppInviteConfig({
  REYLUMI_PUBLIC_APP_INVITE_ENABLED: 'true',
  REYLUMI_CUSTOMER_IOS_INSTALL_URL: iosStore,
  REYLUMI_CUSTOMER_ANDROID_INSTALL_URL: androidStore,
  ...extra,
});

test('public customer invitation stays off until its release flag is explicitly true', () => {
  for (const flag of [undefined, '', 'false', 'TRUE', '1', ' true ']) {
    const value = config({ REYLUMI_PUBLIC_APP_INVITE_ENABLED: flag, REYLUMI_PUBLIC_GIFT_APP_HANDOFF_ENABLED: 'true' });
    assert.equal(value.enabled, false);
    assert.equal(value.iosStoreUrl, null);
    assert.equal(value.androidStoreUrl, null);
    assert.equal(value.giftHandoffEnabled, false);
    assert.equal(invite.publicAppInviteAction(value, 'ios', invite.publicAppInviteTarget(`/check-in/${entry}`)), null);
  }
  assert.equal(publicAppInviteConfig().enabled, false);
  assert.equal(config().enabled, true);
  assert.equal(config().giftHandoffEnabled, false);
});

test('store configuration pins the exact Reylumi apps and removes unrelated queries', () => {
  const value = config({
    REYLUMI_CUSTOMER_IOS_INSTALL_URL: `${iosStore}?next=${encodeURIComponent(`/gift-cards#card=${token}`)}&ct=shared`,
    REYLUMI_CUSTOMER_ANDROID_INSTALL_URL: `${androidStore}&referrer=${token}&hl=vi`,
  });
  assert.equal(value.iosStoreUrl, iosStore);
  assert.equal(value.androidStoreUrl, androidStore);
  for (const href of [
    `https://apps.apple.com/app/id${REYLUMI_IOS_APP_ID}`,
    `https://apps.apple.com/app/reylumi/id${REYLUMI_IOS_APP_ID}/`,
    `https://apps.apple.com/vn/app/reylumi/id${REYLUMI_IOS_APP_ID}`,
  ]) assert.equal(config({ REYLUMI_CUSTOMER_IOS_INSTALL_URL: href }).iosStoreUrl, href);
});

test('nonpublic channels, other app identities and unsafe store URLs fail closed per platform', () => {
  const badIOS = [undefined, '', 'not a url', 'https://testflight.apple.com/join/example',
    'http://apps.apple.com/app/id6821394475', 'https://apps.apple.com.evil.test/app/id6821394475',
    'https://evil.test/app/id6821394475', 'https://user:password@apps.apple.com/app/id6821394475',
    'https://apps.apple.com:444/app/id6821394475', 'https://apps.apple.com/app/id6821394475#card=secret',
    'https://apps.apple.com/app/id6821394476', 'https://apps.apple.com/app/id68213944750',
    'https://apps.apple.com/app/id6821394475/more', androidStore];
  for (const href of badIOS) {
    const value = config({ REYLUMI_CUSTOMER_IOS_INSTALL_URL: href });
    assert.equal(value.iosStoreUrl, null, String(href));
    assert.equal(value.androidStoreUrl, androidStore);
  }
  const badAndroid = [undefined, '', 'market://details?id=com.reylumi.android',
    'http://play.google.com/store/apps/details?id=com.reylumi.android',
    'https://play.google.com.evil.test/store/apps/details?id=com.reylumi.android',
    'https://user@play.google.com/store/apps/details?id=com.reylumi.android',
    'https://play.google.com:444/store/apps/details?id=com.reylumi.android',
    'https://play.google.com/store/apps/details?id=com.reylumi.android#token',
    'https://play.google.com/store/apps/details?id=com.other.android',
    'https://play.google.com/store/apps/details?id=com.reylumi.android&id=com.reylumi.android',
    'https://play.google.com/store/apps/details', 'https://play.google.com/store/apps/details/more?id=com.reylumi.android', iosStore];
  for (const href of badAndroid) {
    const value = config({ REYLUMI_CUSTOMER_ANDROID_INSTALL_URL: href });
    assert.equal(value.androidStoreUrl, null, String(href));
    assert.equal(value.iosStoreUrl, iosStore);
  }
});

test('only mobile browsers with a configured public channel receive an invitation', () => {
  for (const userAgent of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 'iPod']) {
    assert.equal(invite.publicAppInvitePlatform({ userAgent }), 'ios');
  }
  assert.equal(invite.publicAppInvitePlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 5 }), 'ios');
  assert.equal(invite.publicAppInvitePlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' }), 'android');
  for (const userAgent of ['', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)']) {
    assert.equal(invite.publicAppInvitePlatform({ userAgent }), null);
  }
  for (const device of [
    { userAgent: 'iPhone ReylumiIOS/1.0.0' },
    { userAgent: 'Android ReylumiAndroid/1.0.0' },
    { userAgent: 'iPhone', native: true },
    { userAgent: 'Android', native: true },
    { userAgent: 'iPhone', standalone: true },
    { userAgent: 'Android', standalone: true },
  ]) assert.equal(invite.publicAppInvitePlatform(device), null);
  const target = invite.publicAppInviteTarget(`/check-in/${entry}`);
  assert.equal(invite.publicAppInviteAction(config(), null, target), null);
  assert.equal(invite.publicAppInviteAction(config(), 'ios', null), null);
  assert.equal(invite.publicAppInviteAction(config({ REYLUMI_CUSTOMER_IOS_INSTALL_URL: '' }), 'ios', target), null);
  assert.equal(invite.publicAppInviteAction(config({ REYLUMI_CUSTOMER_ANDROID_INSTALL_URL: '' }), 'android', target), null);
});

test('the explicit public route set recognizes share landings and only established check-in handoffs', () => {
  const paths = new Map([
    [`/check-in/${entry}`, 'check-in'], [`/qr?entry=${entry}`, 'check-in'],
    ['/book/salon_123', 'booking'], ['/explore/salons/salon-123', 'salon'],
    ['/explore/salons/salon-123#post-post_123', 'salon'],
    ['/explore/salons/salon-123#transformation-change_123', 'salon'],
    ['/explore/salons/salon-123#look-look_123', 'salon'],
    ['/explore/beauty/profile-123', 'beauty'], ['/explore/beauty/profile-123/posts/post_123', 'beauty'],
    ['/explore/looks/look-123', 'look'], ['/explore/inspiration/look-123', 'look'],
    ['/explore/campaigns/campaign_123', 'campaign'],
  ]);
  for (const [path, kind] of paths) {
    const target = invite.publicAppInviteTarget(`https://reylumi.com${path}`);
    assert.equal(target?.kind, kind, path);
    assert.equal(target.appUrl, kind === 'check-in' ? `reylumi://check-in/${entry}` : null, path);
  }
  for (const origin of ['http://127.0.0.1:3456', 'http://localhost:3456', 'http://[::1]:3456']) {
    assert.equal(invite.publicAppInviteTarget(`${origin}/check-in/${entry}`)?.kind, 'check-in');
  }
});

test('private, payment, malformed, foreign and query-driven destinations never trigger the invitation', () => {
  for (const path of [
    '/', '/explore', '/explore/favorites', '/explore/wisconsin', '/gift-cards', '/gift-cards/manage',
    '/qr', '/qr?scan=1', `/qr?entry=${entry}&next=/admin`, `/qr?entry=${entry}&entry=${entry}`,
    `/qr?entry=${entry}#card=${token}`, '/check-in/not-a-uuid', `/check-in/${entry}/more`,
    `/check-in/${entry}?next=/admin`, `/check-in/${entry}#fragment`, `/visit/${token}`,
    '/login', '/settings', '/staff', '/admin', '/pos/customer-display', '/pos/portable',
    `/booking/manage/${token}`, `/booking-payment/${token}`, `/staff/invite/${token}`, `/ownership/invite/${token}`,
    `/gift-cards#mobile=${token}`, `/gift-cards?order=${token}`, `/gift-cards?salon=123#card=${token}`,
    '/book/salon-123?services=service1', '/book/salon-123#draft', '/book/salon-123/posts/123',
    '/explore/salons/salon-123/posts/123', '/explore/salons/salon-123#token-secret',
    '/explore/beauty/profile-123#draft', '/explore/beauty/profile-123/posts/post-123/more',
    '/explore/salons/name%2Fprivate', '/explore/salons/',
  ]) assert.equal(invite.publicAppInviteTarget(path), null, path);
  for (const href of [
    `https://evil.test/check-in/${entry}`, `https://reylumi.com.evil.test/check-in/${entry}`,
    `https://user:password@reylumi.com/check-in/${entry}`, `reylumi://check-in/${entry}`,
    `javascript:alert(1)`, `file:///check-in/${entry}`, `https://[invalid`,
  ]) assert.equal(invite.publicAppInviteTarget(href), null, href);
});

test('gift bearer links remain exact, private fragments and never enter the store URL', () => {
  const target = invite.publicAppInviteTarget(`/gift-cards#card=${token}`);
  assert.equal(target.kind, 'gift');
  assert.equal(target.appUrl, `reylumi://gift-cards#card=${token}`);
  const action = invite.publicAppInviteAction(config(), 'ios', target);
  assert.equal(action.storeUrl, iosStore);
  assert.equal(action.appUrl, null, 'installed gift receiver is disabled until its native build is available');
  const enabledAction = invite.publicAppInviteAction(config({ REYLUMI_PUBLIC_GIFT_APP_HANDOFF_ENABLED: 'true' }), 'ios', target);
  assert.equal(enabledAction.appUrl, target.appUrl);
  assert.ok(!enabledAction.storeUrl.includes(token));
  assert.equal(new URL(enabledAction.storeUrl).search, '');
  assert.equal(new URL(enabledAction.storeUrl).hash, '');
  for (const fragment of [
    `#card=${token.toUpperCase()}`, `#card=${token.slice(1)}`, `#card=${token}0`,
    `#card=${token}&mobile=${token}`, `#card=${token}&next=/admin`, `#card=${token}%26extra`,
    `#mobile=${token}`, '#card=', `#card=${'g'.repeat(64)}`,
  ]) assert.equal(invite.publicAppInviteTarget('/gift-cards' + fragment), null, fragment);
});

test('only iOS check-in and explicitly enabled gift targets can open a custom scheme', () => {
  const targets = [
    invite.publicAppInviteTarget(`/check-in/${entry}`), invite.publicAppInviteTarget(`/gift-cards#card=${token}`),
    invite.publicAppInviteTarget('/book/salon-123'), invite.publicAppInviteTarget('/explore/beauty/profile-123'),
  ];
  const enabledConfig = config({ REYLUMI_PUBLIC_GIFT_APP_HANDOFF_ENABLED: 'true' });
  for (const target of targets) {
    const action = invite.publicAppInviteAction(enabledConfig, 'android', target);
    assert.equal(action.storeUrl, androidStore);
    assert.equal(action.appUrl, null, target.kind);
  }
  assert.equal(invite.publicAppInviteAction(config(), 'ios', targets[0]).appUrl, `reylumi://check-in/${entry}`);
  for (const target of targets.slice(2)) assert.equal(invite.publicAppInviteAction(enabledConfig, 'ios', target).appUrl, null);
  assert.equal(config({ REYLUMI_PUBLIC_GIFT_APP_HANDOFF_ENABLED: 'TRUE' }).giftHandoffEnabled, false);
});

test('dismissal is a seven-day timestamp with safe recovery from invalid or future storage', () => {
  const now = 1_800_000_000_000;
  assert.equal(invite.PUBLIC_APP_INVITE_DISMISS_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(invite.PUBLIC_APP_INVITE_DISMISS_KEY, 'reylumi.public-app-invite.dismissed.v1');
  assert.equal(invite.publicAppInviteDismissed(String(now), now), true);
  assert.equal(invite.publicAppInviteDismissed(String(now - invite.PUBLIC_APP_INVITE_DISMISS_MS + 1), now), true);
  assert.equal(invite.publicAppInviteDismissed(String(now - invite.PUBLIC_APP_INVITE_DISMISS_MS), now), false);
  for (const value of [null, '', ' ', 'not-a-time', 'Infinity', 'NaN', '0', '-1', String(now + 1), JSON.stringify({ timestamp: now, token })]) {
    assert.equal(invite.publicAppInviteDismissed(value, now), false, String(value));
  }
});
