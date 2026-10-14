(() => {
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
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; hideAdmin(); });
  }).observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', hideAdmin);
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
