(() => {
  'use strict';
  if (window.top !== window || !window.__reylumiPortableHost) return;
  const handler = window.webkit?.messageHandlers?.portableDevice;
  if (!handler) return;
  const nonce = window.__reylumiPortableHost.nonce;
  let locked = true;
  const failure = (reply) => {
    const error = new Error(reply?.error || 'Portable storage is unavailable. Your ticket has not been saved.');
    error.code = reply?.code || 'storage-unavailable';
    return error;
  };
  const request = async (input) => {
    if (input.action === 'storage.prepare' || input.action === 'storage.lock') locked = true;
    const reply = await handler.postMessage({ ...input, version: 1, nonce, path: location.pathname + location.search + location.hash });
    if (!reply || reply.__portableError) throw failure(reply?.__portableError);
    if (input.action === 'storage.prepare' && reply.ok === true) locked = false;
    if (input.action === 'storage.lock') locked = true;
    return reply;
  };
  const sync = (action, key, value) => {
    if (locked) throw failure({ code: 'storage-locked', error: 'Connect and unlock POS Portable before opening saved tickets.' });
    let reply;
    try {
      reply = JSON.parse(window.prompt('__reylumiPortableDevice:' + JSON.stringify({ version: 1, nonce, action, key, path: location.pathname + location.search + location.hash, ...(value === undefined ? {} : { value }) }), '') || 'null');
    } catch { throw failure(); }
    if (!reply?.ok) throw failure(reply);
    return reply.value ?? null;
  };
  const lock = () => {
    locked = true;
    void request({ action: 'storage.lock' }).catch(() => {});
  };
  Object.defineProperty(window, '__reylumiPortableDevice', { configurable: false, value: Object.freeze({
    version: 1,
    platform: 'ios',
    request,
    storage: Object.freeze({
      get: (key) => sync('storage.get', key),
      set: (key, value) => { sync('storage.set', key, value); },
      remove: (key) => { sync('storage.remove', key); },
    }),
  }) });
  window.addEventListener('kingpos:portable-lock', lock);
  window.addEventListener('reylumi:app-local-reset', () => { locked = true; });
  window.addEventListener('pagehide', () => { locked = true; });
})();
