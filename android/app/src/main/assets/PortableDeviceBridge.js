(() => {
  'use strict';
  if (window.top !== window || window.__reylumiPortableDevice) return;
  const channel = window.reylumiPortable;
  if (!channel?.postMessage) return;
  const pending = new Map(), writers = new Map();
  let nonce = null, documentGeneration = -1, locked = true, epoch = 0, sequence = 0;
  const failure = reply => Object.assign(new Error(reply?.error || 'Portable storage is unavailable. Your ticket has not been saved.'), {code: reply?.code || 'storage-unavailable'});
  const invalidate = () => { epoch += 1; locked = true; writers.clear(); };
  channel.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    const entry = pending.get(message?.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    entry.resolve(message.reply);
  };
  const send = input => new Promise((resolve, reject) => {
    if (typeof nonce !== 'string' || documentGeneration < 0) { reject(failure({code: 'stale-host', error: 'POS native storage is still opening. Try again.'})); return; }
    const id = nonce + ':' + (++sequence);
    const timer = setTimeout(() => { pending.delete(id); reject(failure()); }, 90000);
    pending.set(id, {resolve, timer});
    try { channel.postMessage(JSON.stringify({...input, id, version: 1, nonce, documentGeneration, path: location.pathname + location.search + location.hash})); }
    catch { pending.delete(id); clearTimeout(timer); reject(failure()); }
  });
  const request = async input => {
    if (input.action === 'storage.prepare' || input.action === 'storage.lock') invalidate();
    const requestedEpoch = epoch;
    const receiptKey = input.action === 'operations.save' && input.operation?.kind === 'receipt' ? input.operation.payload?.localDraftKey : undefined;
    const reply = await send({...input, ...(typeof receiptKey === 'string' ? {writerToken: writers.get(receiptKey)} : {})});
    // No submitted receipt is checkpoint 0. Validate the action's wire type;
    // truthiness would turn a valid cold draft recovery into a storage failure.
    const validReply = input.action === 'operations.checkpoint'
      ? typeof reply === 'number' && Number.isFinite(reply) && reply >= 0
      : input.action === 'operations.list'
        ? Array.isArray(reply)
        : reply !== null && typeof reply === 'object' && !Array.isArray(reply);
    if (!validReply || reply?.__portableError) throw failure(reply?.__portableError);
    if (requestedEpoch !== epoch && input.action !== 'mode.get' && input.action !== 'mode.set') {
      if (input.action === 'storage.lock') return reply;
      if (input.action === 'writer.acquire' && reply.acquired === true && typeof reply.token === 'string') void send({action: 'writer.release', key: input.key, token: reply.token}).catch(() => {});
      throw failure({code: 'stale-host', error: 'The POS session changed. Open it again.'});
    }
    if (input.action === 'storage.prepare' && reply.ok === true) locked = false;
    if (input.action === 'storage.lock') locked = true;
    if (input.action === 'writer.acquire' && reply.acquired === true && typeof reply.token === 'string') writers.set(input.key, reply.token);
    if (input.action === 'writer.release' && writers.get(input.key) === input.token) writers.delete(input.key);
    return reply;
  };
  const sync = (action, key, value) => {
    if (locked) throw failure({code: 'storage-locked', error: 'Connect and unlock POS Portable before opening saved tickets.'});
    let reply;
    try { reply = JSON.parse(window.prompt('__reylumiPortableDevice:' + JSON.stringify({version: 1, nonce, documentGeneration, action, key, writerToken: writers.get(key), path: location.pathname + location.search + location.hash, ...(value === undefined ? {} : {value})}), '') || 'null'); }
    catch { throw failure(); }
    if (!reply?.ok) throw failure(reply);
    return reply.value ?? null;
  };
  const lock = () => { invalidate(); void request({action: 'storage.lock'}).catch(() => {}); };
  Object.defineProperty(window, '__reylumiPortableDevice', {configurable: false, value: Object.freeze({
    version: 1, platform: 'android', request,
    storage: Object.freeze({get: key => sync('storage.get', key), set: (key, value) => { sync('storage.set', key, value); }, remove: key => { sync('storage.remove', key); }}),
  })});
  Object.defineProperty(window, '__reylumiPortableBindHost', {configurable: false, value: meta => {
    if (!meta || typeof meta.nonce !== 'string' || !/^[a-f0-9-]{36}$/i.test(meta.nonce) || !Number.isSafeInteger(meta.documentGeneration) || meta.documentGeneration < 0) return;
    if (nonce === meta.nonce && documentGeneration === meta.documentGeneration) return;
    invalidate(); nonce = meta.nonce; documentGeneration = meta.documentGeneration;
    window.dispatchEvent(new Event('kingpos:portable-native-ready'));
  }});
  window.addEventListener('kingpos:portable-lock', lock);
  for (const name of ['reylumi:app-local-reset', 'kingpos:native-writer-reset', 'kingpos:native-portable-lock', 'pagehide']) window.addEventListener(name, invalidate);
  window.__reylumiPortableBindHost(window.__reylumiPortableHost);
})();
