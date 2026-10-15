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
  window.__reylumiStartup = Object.freeze({
    setNavigationContext: (context) => {
      if (!context || context.origin !== location.origin || location.protocol !== 'https:' || excluded(location.pathname) ||
          !Number.isSafeInteger(context.generation) || context.generation < 1 ||
          typeof context.nonce !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.nonce)) return false;
      if (navigationContext && context.generation < navigationContext.generation) return false;
      navigationContext = { nonce: context.nonce, generation: context.generation };
      scheduleReady();
      return true;
    },
  });
  window.addEventListener?.('reylumi:screen-ready', () => { screenReady = true; scheduleReady(); });
  document.addEventListener('visibilitychange', scheduleReady);
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
      return original.apply(this, arguments);
    };
  }
  if (typeof navigator.share !== 'function') {
    navigator.share = async ({ title, text, url }) => send({ action: 'share', text: [title, text, url].filter(Boolean).join('\n') });
  }
})();
