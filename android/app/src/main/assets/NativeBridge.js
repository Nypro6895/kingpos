(() => {
  const trustedOrigin = 'https://reylumi.com';
  if (window.top !== window || location.origin !== trustedOrigin || !window.reylumiAndroid) return;
  if (window.__reylumiAndroidBridgeReady) return;
  Object.defineProperty(window, '__reylumiAndroidBridgeReady', {value: true});
  const send = value => window.reylumiAndroid.postMessage(JSON.stringify(value));
  if (typeof navigator.share !== 'function') {
    navigator.share = async ({title, text, url} = {}) => {
      const content = [title, text, url].filter(value => typeof value === 'string' && value.trim()).join('\n');
      if (!content || content.length > 16000) throw new TypeError('Invalid share content');
      send({action: 'share', text: content});
    };
  }
  window.print = () => send({action: 'print'});
  const receiptJobs = new Map();
  window.__reylumiReceiptPrintResult = result => {
    const entry = receiptJobs.get(result?.jobId);
    if (!entry || !['presented', 'submitted', 'cancelled', 'failed'].includes(result.status)) return;
    receiptJobs.delete(result.jobId); clearTimeout(entry.timer); entry.resolve(result);
  };
  Object.defineProperty(window, '__reylumiReceiptPrint', {value: Object.freeze({version: 1,
    print: job => new Promise((resolve, reject) => {
      if (!job || job.version !== 1 || typeof job.jobId !== 'string' || typeof job.html !== 'string'
        || new TextEncoder().encode(job.html).length > 1024 * 1024 || receiptJobs.has(job.jobId)) {
        reject(new Error('Invalid receipt print job.')); return;
      }
      const timer = setTimeout(() => { receiptJobs.delete(job.jobId); reject(new Error('Receipt printing did not respond. Try again.')); }, 60000);
      receiptJobs.set(job.jobId, {resolve, timer}); send({action: 'print-receipt', job});
    })
  })});
  if (/\sReylumiAndroidPOS\//.test(navigator.userAgent)) {
    // A document transition runs native admission before revealing another private page.
    document.addEventListener('click', event => {
      const anchor = event.target.closest?.('a[href]');
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || anchor.target || anchor.download) return;
      const target = new URL(anchor.href, location.href);
      if (target.origin === location.origin && /^\/pos\/portable(?:\/(?:check-in|book|ticket|today|report))?$/.test(target.pathname)
        && !target.search && target.href !== location.href) {
        event.preventDefault(); event.stopImmediatePropagation(); location.assign(target.href);
      }
    }, true);
  }
  window.__reylumiAndroidDownload = async (url, filename) => {
    try {
      const target = new URL(url, location.href);
      if (!(target.protocol === 'blob:' && target.origin === location.origin) &&
          !(['https:', 'http:'].includes(target.protocol) && target.origin === trustedOrigin)) throw new Error('Unsupported origin');
      const response = await fetch(target.href, {credentials: 'same-origin', redirect: 'error'});
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      if (blob.size > 10 * 1024 * 1024) throw new Error('File too large');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      send({action: 'save-file', filename: filename || 'Reylumi-export', mime: blob.type || 'application/octet-stream', base64: btoa(binary)});
    } catch { send({action: 'download-failed'}); }
  };
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[download]');
    if (!anchor || !anchor.href.startsWith('blob:' + location.origin + '/')) return;
    event.preventDefault();
    window.__reylumiAndroidDownload(anchor.href, anchor.download);
  });
  window.__reylumiAndroidBack = () => {
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    const cameraClose = document.querySelector('section[aria-label="QR camera"] button');
    if (cameraClose && visible(cameraClose)) { cameraClose.click(); return true; }
    const dialog = [...document.querySelectorAll('[role="dialog"],dialog[open]')].filter(visible).at(-1);
    if (!dialog) {
      const popover = [...document.querySelectorAll('details[data-dismissible-popover][open]')].find(visible);
      if (!popover) return false;
      popover.querySelector('summary')?.click();
      return true;
    }
    // Custom sheets opt in on their own element and run their authored close/guard.
    if (!dialog.dispatchEvent(new Event('reylumi:native-overlay-dismiss', {cancelable: true}))) return true;
    // Gift content can have its own role=dialog inside the native top-layer dialog.
    const nativeDialog = dialog.closest('dialog[open]');
    if (nativeDialog instanceof HTMLDialogElement) {
      // Synthetic Escape key events do not run the browser's native cancel action.
      // Preserve the dialog's pending/dirty guards before performing that action.
      if (nativeDialog.dispatchEvent(new Event('cancel', {cancelable: true}))) nativeDialog.close();
      return true;
    }
    const close = [...dialog.querySelectorAll('button')].find(button => visible(button) &&
      /^(close|close (?:account switcher|dialog|modal|menu|settings|panel|history details|reschedule|cancellation|booking|preview)|×|✕|x|đóng)$/i.test((button.getAttribute('aria-label') || button.innerText).trim()));
    if (close) { close.click(); return true; }
    // Legacy custom dialogs may own document Escape handlers and dirty guards.
    // Consume Back even when they refuse it: true means handled/blocked, not closed.
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', bubbles: true, cancelable: true}));
    return true;
  };
})();
