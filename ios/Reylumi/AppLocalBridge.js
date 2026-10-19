(() => {
  'use strict';
  if (location.protocol !== 'reylumi-app:' || location.hostname !== 'bundle' || window.top !== window) return;
  const handler = window.webkit?.messageHandlers?.appLocal;
  if (!handler || !window.__reylumiAppLocalContext) return;
  // Set only for an explicitly enabled local diagnostic run. This script runs
  // before app.js; no identifier or bridge metadata enters the numeric mark.
  if (window.__reylumiDiagnosticsEnabled === true) window.__reylumiBundleParseStartedAt = performance.now();
  const request = async (input) => {
    const context = window.__reylumiAppLocalContext;
    const reply = await handler.postMessage({ ...input, version: 1, nonce: context.nonce, scopeEpoch: context.scopeEpoch });
    if (reply?.__hostError) {
      const error = new Error(reply.__hostError.message || 'Please try again.');
      error.status = reply.__hostError.status;
      if (reply.__hostError.reason === 'cancelled' || reply.__hostError.reason === 'staleCookies') {
        error.reason = reply.__hostError.reason;
        error.name = 'AbortError';
      }
      throw error;
    }
    // Adopt native metadata before resolving a context promise. The parallel
    // DOM event can arrive later than the reply on a busy WebKit process.
    const logout = input.kind === 'command' && input.name === 'shell.logout' && reply?.signedOut === true && reply.status >= 200 && reply.status < 300;
    const host = input.kind === 'context' || logout ? reply?.host : null;
    if (host?.version === 1 && typeof host.nonce === 'string' && typeof host.generation === 'string' && Number.isSafeInteger(host.scopeEpoch) && host.scopeEpoch >= window.__reylumiAppLocalContext.scopeEpoch) window.__reylumiAppLocalContext = host;
    return reply;
  };
  Object.defineProperty(window, '__reylumiAppLocalTransport', { configurable: false, value: Object.freeze({ request }) });
  const requestID = () => {
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  window.__reylumiBackgroundSync = Object.freeze({
    register: (args) => request({ id: requestID(), kind: 'cache', name: 'background.register', args }),
    drain: (scope) => request({ id: requestID(), kind: 'cache', name: 'background.drain', args: { scope } }),
  });
  window.addEventListener('kingpos:portable-lock', () => {
    // Revoke native display authority too; never delete the original receipt
    // queue or resubmit an unfinished command when the UI is locked.
    void request({ id: requestID(), kind: 'cache', name: 'portable.lock', args: {} }).catch(() => {});
  });
  const nativeUI = window.webkit?.messageHandlers?.reylumi;
  if (nativeUI) {
    if (window.__reylumiDiagnosticsEnabled === true) {
      Object.defineProperty(window, '__reylumiExportDiagnostics', { value: () => {
        const entries = window.__reylumiDiagnostics?.snapshot() ?? [];
        nativeUI.postMessage({ action: 'diagnostics-export', entries });
      } });
    }
    Object.defineProperty(window, '__reylumiNativePayments', { value: 1 });
    window.print = () => nativeUI.postMessage({ action: 'print' });
    if (typeof navigator.share !== 'function') navigator.share = async ({ title, text, url }) => nativeUI.postMessage({ action: 'share', text: [title, text, url].filter(Boolean).join('\n') });
  }
  let ready = false;
  const publishReady = () => {
    if (ready || document.visibilityState === 'hidden') return;
    const shell = [...document.querySelectorAll('[data-reylumi-shell-ready="true"], [data-app-local-ready="true"]')].some(node => node.getClientRects().length > 0);
    if (!shell) return;
    ready = true;
    void request({ id: window.__reylumiAppLocalContext.nonce, kind: 'cache', name: 'ready', args: {} }).catch(() => { ready = false; });
  };
  let paintScheduled = false;
  const afterPaint = () => {
    if (ready || paintScheduled) return;
    paintScheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { paintScheduled = false; publishReady(); }, 0)));
  };
  window.addEventListener('reylumi:screen-ready', afterPaint);
  document.addEventListener('DOMContentLoaded', afterPaint, { once: true });
  const observer = new MutationObserver(afterPaint);
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-reylumi-shell-ready', 'data-app-local-ready'] });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();
