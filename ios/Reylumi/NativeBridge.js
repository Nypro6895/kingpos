(() => {
  Object.defineProperty(window, '__reylumiNativePayments', {value: 1});
  const send = (message) => window.webkit.messageHandlers.reylumi.postMessage(message);
  window.print = () => send({ action: 'print' });
  // Restrict these UI entries as well as native/server navigation enforcement.
  const excluded = (pathname) => {
    try {
      const path = decodeURIComponent(pathname).toLowerCase().replaceAll('\\', '/');
      return ['/admin', '/api/admin', '/settings/recovery-back-office', '/api/pos/windows-download'].some(p => path === p || path.startsWith(p + '/'));
    } catch { return true; }
  };
  const hideAdmin = () => document.querySelectorAll('a[href]').forEach(link => {
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin && excluded(url.pathname)) link.hidden = true;
  });
  let navigationContext = null;
  let screenReady = false;
  let sentNonce = null;
  let readyScheduled = false;
  let routeReady = false;
  let routeReadyScheduled = false;
  let sentRoute = null;
  let preparedRoute = null;
  let clearOffline = false;
  const sendOfflineState = () => {
    if (!navigationContext || excluded(location.pathname)) return;
    const context = { nonce: navigationContext.nonce, generation: navigationContext.generation, origin: location.origin };
    if (clearOffline) {
      clearOffline = false;
      send({ action: 'offline-clear', ...context });
    }
    if (!preparedRoute) return;
    const route = preparedRoute;
    preparedRoute = null;
    if (route.path !== location.pathname || location.search || location.hash || Date.parse(route.expiresAt) <= Date.now()) return;
    send({ action: 'offline-ready', ...context, ...route });
  };
  const hasReadyShell = () => {
    const shells = document.querySelectorAll?.('[data-reylumi-shell-ready="true"]') ?? [];
    return Array.from(shells).some(shell => shell.getClientRects().length > 0);
  };
  const sendReady = () => {
    readyScheduled = false;
    if (!navigationContext || sentNonce === navigationContext.nonce || document.visibilityState === 'hidden' || excluded(location.pathname)) return;
    if (!screenReady && !hasReadyShell()) return;
    screenReady = true;
    sentNonce = navigationContext.nonce;
    send({ action: 'screen-ready', nonce: navigationContext.nonce, generation: navigationContext.generation, origin: location.origin });
  };
  const scheduleReady = () => {
    if (readyScheduled || sentNonce === navigationContext?.nonce) return;
    readyScheduled = true;
    // Let the mounted core UI paint before the native shell fades away.
    requestAnimationFrame(() => requestAnimationFrame(sendReady));
  };
  const scheduleRouteReady = () => {
    if (routeReadyScheduled) return;
    routeReadyScheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      routeReadyScheduled = false;
      if (!navigationContext || !routeReady || document.visibilityState === 'hidden' || excluded(location.pathname)) return;
      const path = location.pathname + location.search + location.hash;
      const key = navigationContext.nonce + '|' + path;
      if (sentRoute === key) return;
      sentRoute = key;
      send({ action: 'route-ready', path, nonce: navigationContext.nonce, generation: navigationContext.generation, origin: location.origin });
    }));
  };
  window.__reylumiStartup = Object.freeze({
    setNavigationContext: (context) => {
      const secure = location.protocol === 'https:' || (location.protocol === 'http:' && location.hostname === 'localhost' && window.__reylumiDebugLocalOrigin === location.origin);
      if (!context || context.origin !== location.origin || !secure || excluded(location.pathname) ||
          !Number.isSafeInteger(context.generation) || context.generation < 1 ||
          typeof context.nonce !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.nonce)) return false;
      if (navigationContext && context.generation < navigationContext.generation) return false;
      navigationContext = { nonce: context.nonce, generation: context.generation };
      sendOfflineState();
      scheduleReady();
      if (screenReady || hasReadyShell()) routeReady = true;
      scheduleRouteReady();
      return true;
    },
  });
  window.addEventListener?.('reylumi:screen-ready', () => { screenReady = true; routeReady = true; scheduleReady(); scheduleRouteReady(); });
  // This ACK is emitted only after the web worker has committed its complete
  // shell and the web authorization layer has verified the expiring grant.
  // The ordinary screen-ready/public loading shell never qualifies.
  window.addEventListener?.('reylumi:offline-ready', (event) => {
    const detail = event.detail;
    if (!detail || detail.version !== 1 || typeof detail.path !== 'string' || detail.path !== location.pathname ||
        location.search || location.hash || typeof detail.expiresAt !== 'string' || !Number.isFinite(Date.parse(detail.expiresAt)) ||
        Date.parse(detail.expiresAt) <= Date.now() || excluded(location.pathname)) return;
    preparedRoute = { path: detail.path, version: 1, expiresAt: detail.expiresAt };
    sendOfflineState();
  });
  window.addEventListener?.('reylumi:offline-clear', () => {
    preparedRoute = null;
    clearOffline = true;
    sendOfflineState();
  });
  const sendSync = (action, detail) => {
    if (!navigationContext || excluded(location.pathname)) return false;
    send({ ...detail, action, nonce: navigationContext.nonce, generation: navigationContext.generation, origin: location.origin });
    return true;
  };
  window.__reylumiBackgroundSync = Object.freeze({
    register: (detail) => {
      if (!detail || typeof detail.scope !== 'string' || typeof detail.key !== 'string' ||
          typeof detail.endpoint !== 'string' || typeof detail.expiresAt !== 'string') return false;
      return sendSync('background-register', { scope: detail.scope, key: detail.key, endpoint: detail.endpoint, expiresAt: detail.expiresAt });
    },
    drain: (scope) => typeof scope === 'string' && sendSync('background-drain', { scope }),
  });
  document.addEventListener('visibilitychange', () => { scheduleReady(); scheduleRouteReady(); });
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; hideAdmin(); if (sentNonce !== navigationContext?.nonce) scheduleReady(); });
  }).observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => { hideAdmin(); scheduleReady(); });
  // Next.js client routing can change history without a native navigation callback.
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function (state, title, value) {
      if (value != null && excluded(new URL(value, location.href).pathname)) {
        send({ action: 'excluded' });
        return;
      }
      const before = location.href;
      const result = original.apply(this, arguments);
      if (location.href !== before) { routeReady = false; sentRoute = null; }
      return result;
    };
  }
  window.addEventListener?.('popstate', () => { routeReady = false; sentRoute = null; });
  if (typeof navigator.share !== 'function') {
    navigator.share = async ({ title, text, url }) => send({ action: 'share', text: [title, text, url].filter(Boolean).join('\n') });
  }
})();
