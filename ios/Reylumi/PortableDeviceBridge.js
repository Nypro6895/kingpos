(() => {
  'use strict';
  if (window.top !== window || !window.__reylumiPortableHost) return;
  const handler = window.webkit?.messageHandlers?.portableDevice;
  if (!handler) return;
  const nonce = window.__reylumiPortableHost.nonce;
  let locked = true;
  const writers = new Map();
  let epoch = 0;
  const invalidate = () => { epoch += 1; locked = true; writers.clear(); };
  const failure = (reply) => {
    const error = new Error(reply?.error || 'Portable storage is unavailable. Your ticket has not been saved.');
    error.code = reply?.code || 'storage-unavailable';
    return error;
  };
  const request = async (input) => {
    if (input.action === 'storage.prepare' || input.action === 'storage.lock') invalidate();
    const requestedEpoch = epoch;
    const receiptKey = input.action === 'operations.save' && input.operation?.kind === 'receipt' ? input.operation.payload?.localDraftKey : undefined;
    const reply = await handler.postMessage({ ...input, ...(typeof receiptKey === 'string' ? { writerToken: writers.get(receiptKey) } : {}), version: 1, nonce, path: location.pathname + location.search + location.hash });
    if (!reply || reply.__portableError) throw failure(reply?.__portableError);
    if (requestedEpoch !== epoch && input.action !== 'mode.get' && input.action !== 'mode.set') {
      if (input.action === 'storage.lock') return reply;
      // A late acquire must not overwrite a new document's token map. Release
      // only its exact native token; it cannot evict a newer owner's claim.
      if (input.action === 'writer.acquire' && reply.acquired === true && typeof reply.token === 'string') {
        void handler.postMessage({ action: 'writer.release', key: input.key, token: reply.token, version: 1, nonce, path: location.pathname + location.search + location.hash }).catch(() => {});
      }
      throw failure({ code: 'stale-host', error: 'The POS session changed. Open it again.' });
    }
    if (input.action === 'storage.prepare' && reply.ok === true) locked = false;
    if (input.action === 'storage.lock') locked = true;
    if (input.action === 'writer.acquire' && reply.acquired === true && typeof reply.token === 'string') writers.set(input.key, reply.token);
    if (input.action === 'writer.release' && writers.get(input.key) === input.token) writers.delete(input.key);
    return reply;
  };
  const sync = (action, key, value) => {
    if (locked) throw failure({ code: 'storage-locked', error: 'Connect and unlock POS Portable before opening saved tickets.' });
    let reply;
    try {
      reply = JSON.parse(window.prompt('__reylumiPortableDevice:' + JSON.stringify({ version: 1, nonce, action, key, writerToken: writers.get(key), path: location.pathname + location.search + location.hash, ...(value === undefined ? {} : { value }) }), '') || 'null');
    } catch { throw failure(); }
    if (!reply?.ok) throw failure(reply);
    return reply.value ?? null;
  };
  const lock = () => {
    invalidate();
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
  window.addEventListener('reylumi:app-local-reset', invalidate);
  window.addEventListener('kingpos:native-writer-reset', invalidate);
  window.addEventListener('kingpos:native-portable-lock', invalidate);
  window.addEventListener('pagehide', invalidate);
})();
