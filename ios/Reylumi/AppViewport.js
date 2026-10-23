(() => {
  if (!window.webkit?.messageHandlers?.reylumi) return;

  const viewportContent = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no';
  const fieldSelector = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), select, textarea, [contenteditable]:not([contenteditable="false"])';
  const styles = document.createElement('style');
  styles.dataset.reylumiAppViewport = '';
  styles.textContent = `
    html {
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
      touch-action: pan-x pan-y;
      overflow-x: clip;
    }
    body {
      width: 100%;
      max-width: 100%;
      overflow-x: clip;
      overflow-wrap: anywhere;
    }
    :where(main, fieldset, .customer-desktop-content, [data-testid="customer-desktop-shell"]),
    main > :where(div, section, article, form) {
      min-width: 0;
      max-width: 100%;
    }
    :is(input, select, textarea, [contenteditable]) {
      box-sizing: border-box;
      min-width: 0;
      max-width: 100%;
    }
    :is([role="dialog"], dialog) {
      box-sizing: border-box;
      min-width: 0 !important;
      max-width: calc(100dvw - 1rem) !important;
      max-height: calc(100dvh - 1rem) !important;
      overflow: auto !important;
      overscroll-behavior: contain;
    }
  `;

  // Next.js replaces head metadata during client navigation. Keep the native
  // viewport in place on every route, including separate root layouts.
  const ensureViewport = () => {
    if (!document.head) return;
    let viewports = document.head.querySelectorAll('meta[name="viewport" i]');
    if (!viewports.length) {
      const viewport = document.createElement('meta');
      viewport.name = 'viewport';
      document.head.appendChild(viewport);
      viewports = [viewport];
    }
    for (const viewport of viewports) {
      if (viewport.content !== viewportContent) viewport.content = viewportContent;
    }
    if (!styles.isConnected) document.head.appendChild(styles);
  };

  // Only raise small editable text; large POS amounts retain their own size.
  // Prepare mounted fields and repeat before focus to cover lazy editors and
  // stylesheets loaded after the document-start script.
  const prepareField = (field) => {
    if (!field.matches(fieldSelector)) return;
    if (parseFloat(getComputedStyle(field).fontSize) < 16) {
      field.style.setProperty('font-size', '16px', 'important');
    }
  };
  const prepareFields = (root) => {
    if (root.nodeType === Node.ELEMENT_NODE) prepareField(root);
    root.querySelectorAll?.(fieldSelector).forEach(prepareField);
  };

  ensureViewport();
  const pendingRoots = new Set();
  let scheduled = false;
  new MutationObserver((records) => {
    // Repair viewport changes immediately, before the browser paints a frame.
    ensureViewport();
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.matches(fieldSelector)) pendingRoots.add(record.target);
      } else {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) pendingRoots.add(node);
        }
      }
    }
    if (scheduled || !pendingRoots.size) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      for (const root of pendingRoots) {
        if (root.isConnected) prepareFields(root);
      }
      pendingRoots.clear();
    });
  }).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['name', 'content', 'class', 'style'],
  });
  document.addEventListener('DOMContentLoaded', () => {
    ensureViewport();
    prepareFields(document);
  });
  window.addEventListener('load', () => prepareFields(document));
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Element) prepareField(event.target);
  }, true);
})();
