/**
 * Content script (classic, runs in every frame's isolated world).
 *
 * Deliberately minimal so it adds ~nothing to page load: it only
 *   (a) remembers which editable element was most recently right-clicked, and
 *   (b) lazily imports the generator panel the first time it is actually needed.
 *
 * The heavy UI/generation code lives in ES modules that are dynamically
 * imported on demand — nothing of the panel is parsed until the user invokes
 * the context menu.
 */

(() => {
  // Guard against double-injection (e.g. SPA soft-navigations re-running us).
  if (window.__cpgContentLoaded) return;
  window.__cpgContentLoaded = true;

  /** @type {Element|null} The field under the last contextmenu event. */
  let lastTarget = null;

  /** Is this element something we can meaningfully insert text into? */
  function isEditable(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.disabled || el.readOnly) return false;

    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      // Text-like types only. 'number' and other specialized inputs are
      // excluded because they reject arbitrary password strings (see insert.js).
      const EDITABLE_INPUT_TYPES = new Set([
        'text', 'password', 'email', 'search', 'url', 'tel'
      ]);
      return EDITABLE_INPUT_TYPES.has(type);
    }
    // contenteditable (including inherited "true"/"plaintext-only").
    if (el.isContentEditable) return true;
    return false;
  }

  // Record the right-clicked target during the capture phase, before the page
  // can stop propagation. Walk up a little for contenteditable children.
  document.addEventListener(
    'contextmenu',
    (event) => {
      let el = event.target;
      // For contenteditable, the event target may be a child node/element.
      if (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentElement;
      let node = el;
      while (node && !isEditable(node)) {
        node = node.parentElement;
      }
      lastTarget = node && isEditable(node) ? node : null;
    },
    true
  );

  let panelModulePromise = null;
  function getPanelModule() {
    if (!panelModulePromise) {
      panelModulePromise = import(chrome.runtime.getURL('src/ui/panel.js'));
    }
    return panelModulePromise;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return;

    let target = null;

    if (message.type === 'CPG_OPEN_PANEL') {
      // Opened from the right-click menu: use the field that was right-clicked.
      if (lastTarget && lastTarget.isConnected && isEditable(lastTarget)) {
        target = lastTarget;
      } else {
        sendResponse({ ok: false, reason: 'no-target' });
        return;
      }
    } else if (message.type === 'CPG_OPEN_ACTION') {
      // Opened from the toolbar icon: no right-clicked field. Capture the
      // currently focused editable element (if any) BEFORE the panel opens and
      // steals focus, so Insert still has a destination. Otherwise open in a
      // copy-only mode.
      const candidate =
        lastTarget && lastTarget.isConnected && isEditable(lastTarget)
          ? lastTarget
          : document.activeElement;
      target = isEditable(candidate) ? candidate : null;
    } else {
      return;
    }

    getPanelModule()
      .then((mod) => mod.openPanel(target))
      .catch(() => {
        /* panel failed to load; fail silently on the page */
      });

    sendResponse({ ok: true });
    return; // synchronous response already sent
  });
})();
