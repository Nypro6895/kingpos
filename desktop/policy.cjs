'use strict';
function validConfig(config) {
  const url = new URL(config.origin);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Expected an origin without a path or credentials');
  if (url.protocol !== 'https:' && !(config.channel === 'test' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('HTTPS is required');
  if (!['test', 'release'].includes(config.channel)) throw Error('Unknown channel');
  if (config.updates && config.channel === 'test') {
    const feed = new URL(config.updateUrl);
    if (!config.unsignedUpdates || !['localhost', '127.0.0.1'].includes(feed.hostname) ||
        feed.origin !== url.origin || feed.pathname !== '/desktop-updates/' || feed.username || feed.password || feed.search || feed.hash) throw Error('Test updates must use the same local KingPOS server');
  }
  return { ...config, origin: url.origin };
}
function allowedPage(value, origin) {
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password &&
      (url.pathname === '/pos/portable' || url.pathname.startsWith('/pos/portable/'));
  } catch { return false; }
}
function validateKey(value) {
  if (typeof value !== 'string' || value.length > 1024 || !/^kingpos:(portable-draft:v1:|parked-tickets:v1:|report-inputs:|offline-staff:)/.test(value)) throw Error('Invalid storage key');
  return value;
}
module.exports = { validConfig, allowedPage, validateKey };
