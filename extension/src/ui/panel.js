/**
 * Floating generator panel (Shadow DOM, ES module, lazily imported).
 *
 * Imported on demand by the content script. Renders a compact password-manager
 * style panel inside a closed Shadow DOM so hostile page CSS cannot alter it and
 * page scripts cannot read the generated password before the user explicitly
 * inserts it.
 */

import { generatePassword, getPoolSize, validateConfig } from '../generator/password.js';
import { evaluateStrength } from '../generator/strength.js';
import { loadPreferences, savePreferences } from '../storage/preferences.js';
import { insertIntoTarget } from './insert.js';

const HOST_ID = 'cpg-shadow-host';

/** i18n helper with a plain-text fallback so the panel never renders blank. */
function t(key, fallback) {
  try {
    return chrome.i18n.getMessage(key) || fallback || key;
  } catch {
    return fallback || key;
  }
}

/** Resolve a packaged extension resource URL (icons etc.). */
function extURL(path) {
  try {
    return chrome.runtime.getURL(path);
  } catch {
    return '';
  }
}

/** Current open panel instance (singleton). */
let active = null;

/** Build the static panel markup. All strings come from our own i18n catalog. */
function panelTemplate() {
  const logoUrl = extURL('icons/icon48.png');
  return `
  <div class="cpg-panel" role="dialog" aria-modal="false" aria-label="${t('panelTitle', 'Password Generator')}">
    <header class="cpg-header">
      <img class="cpg-logo" src="${logoUrl}" alt="" aria-hidden="true" width="18" height="18" />
      <h1 class="cpg-title">${t('panelTitle', 'Password Generator')}</h1>
      <button type="button" class="cpg-icon-btn cpg-close" data-action="close"
        aria-label="${t('close', 'Close')}" title="${t('close', 'Close')}">✕</button>
    </header>

    <label class="cpg-field-label" for="cpg-output">${t('generatedPassword', 'Generated Password')}</label>
    <div class="cpg-output-row">
      <input id="cpg-output" class="cpg-output" type="text" readonly spellcheck="false"
        autocomplete="off" aria-label="${t('generatedPassword', 'Generated Password')}" />
      <button type="button" class="cpg-icon-btn" data-action="toggle"
        aria-label="${t('showHide', 'Show or hide password')}" title="${t('showHide', 'Show or hide password')}"
        aria-pressed="true">👁</button>
      <button type="button" class="cpg-icon-btn" data-action="regenerate"
        aria-label="${t('regenerate', 'Regenerate')}" title="${t('regenerate', 'Regenerate')}">↻</button>
      <button type="button" class="cpg-icon-btn" data-action="copy"
        aria-label="${t('copy', 'Copy')}" title="${t('copy', 'Copy')}">⧉</button>
    </div>

    <div class="cpg-strength" aria-live="polite">
      <div class="cpg-strength-track"><div class="cpg-strength-fill"></div></div>
      <span class="cpg-strength-label"></span>
    </div>

    <div class="cpg-length-row">
      <label class="cpg-field-label" for="cpg-length-num">${t('passwordLength', 'Password Length')}</label>
      <input id="cpg-length-num" class="cpg-length-num" type="number" min="4" max="128" step="1"
        inputmode="numeric" aria-label="${t('passwordLength', 'Password Length')}" />
    </div>
    <input id="cpg-length-slider" class="cpg-slider" type="range" min="4" max="128" step="1"
      aria-label="${t('passwordLength', 'Password Length')}" />

    <button type="button" class="cpg-options-toggle" data-action="toggle-options"
      aria-expanded="false" aria-controls="cpg-options">
      <span class="cpg-caret" aria-hidden="true">▸</span>
      <span>${t('characterOptions', 'Character Options')}</span>
    </button>

    <fieldset class="cpg-options" id="cpg-options" hidden>
      <legend class="cpg-visually-hidden">${t('characterOptions', 'Character Options')}</legend>
      <label class="cpg-check"><input type="checkbox" data-opt="uppercase" /><span>${t('uppercase', 'Uppercase (A–Z)')}</span></label>
      <label class="cpg-check"><input type="checkbox" data-opt="lowercase" /><span>${t('lowercase', 'Lowercase (a–z)')}</span></label>
      <label class="cpg-check"><input type="checkbox" data-opt="numbers" /><span>${t('numbers', 'Numbers (0–9)')}</span></label>
      <label class="cpg-check"><input type="checkbox" data-opt="symbols" /><span>${t('symbols', 'Special (!@#$…)')}</span></label>
      <label class="cpg-check"><input type="checkbox" data-opt="excludeAmbiguous" /><span>${t('excludeAmbiguous', 'Exclude ambiguous (O 0 I l 1)')}</span></label>
    </fieldset>

    <p class="cpg-error" role="alert" hidden></p>

    <button type="button" class="cpg-insert" data-action="insert">${t('insertPassword', 'Insert Password')}</button>
    <div class="cpg-toast" role="status" aria-live="polite" hidden></div>
  </div>`;
}

/** Read the current configuration from the UI controls. */
function readConfig(root) {
  // Clamp length so a transient out-of-range entry (while typing) never throws
  // during live regeneration; the numeric field snaps to range on blur.
  let length = Number.parseInt(root.getElementById('cpg-length-num').value, 10);
  if (!Number.isFinite(length)) length = 20;
  length = Math.min(128, Math.max(4, length));
  return {
    length,
    uppercase: root.querySelector('[data-opt="uppercase"]').checked,
    lowercase: root.querySelector('[data-opt="lowercase"]').checked,
    numbers: root.querySelector('[data-opt="numbers"]').checked,
    symbols: root.querySelector('[data-opt="symbols"]').checked,
    excludeAmbiguous: root.querySelector('[data-opt="excludeAmbiguous"]').checked
  };
}

/** Write a configuration into the UI controls. */
function writeConfig(root, cfg) {
  root.getElementById('cpg-length-num').value = String(cfg.length);
  root.getElementById('cpg-length-slider').value = String(cfg.length);
  for (const opt of ['uppercase', 'lowercase', 'numbers', 'symbols', 'excludeAmbiguous']) {
    root.querySelector(`[data-opt="${opt}"]`).checked = Boolean(cfg[opt]);
  }
}

async function copyToClipboard(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Fallback for pages/contexts where the async Clipboard API is blocked.
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Position the panel near the target, kept fully within the viewport. */
function positionPanel(panel, target) {
  const margin = 8;
  const pw = panel.offsetWidth || 360;
  const ph = panel.offsetHeight || 320;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  let left;
  let top;

  if (target && target.isConnected) {
    // Anchor below the field (flip above if it would overflow the bottom).
    const rect = target.getBoundingClientRect();
    left = rect.left;
    top = rect.bottom + margin;
    if (top + ph + margin > vh) {
      const above = rect.top - ph - margin;
      top = above >= margin ? above : Math.max(margin, vh - ph - margin);
    }
  } else {
    // Opened from the toolbar (no field): anchor near the top-right, under the
    // toolbar area.
    left = vw - pw - margin;
    top = margin;
  }

  if (left + pw + margin > vw) left = vw - pw - margin;
  if (left < margin) left = margin;

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

/**
 * Keep the panel inside the viewport WITHOUT re-anchoring it to the target.
 * Used when the panel's size changes (e.g. expanding Character Options) so it
 * grows/shrinks in place instead of jumping back to the field.
 */
function clampIntoView(panel) {
  const margin = 8;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const rect = panel.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;
  if (rect.right > vw - margin) left = vw - rect.width - margin;
  if (left < margin) left = margin;
  if (rect.bottom > vh - margin) top = vh - rect.height - margin;
  if (top < margin) top = margin;
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

/** Tear down the active panel and detach all global listeners. */
function closePanel() {
  if (!active) return;
  document.removeEventListener('mousedown', active.onOutside, true);
  document.removeEventListener('keydown', active.onKeydown, true);
  window.removeEventListener('resize', active.onReposition, true);
  window.removeEventListener('scroll', active.onReposition, true);
  active.host.remove();
  active = null;
}

/**
 * Open the generator panel for a target editable element.
 * @param {Element} target
 */
export async function openPanel(target) {
  closePanel(); // singleton

  const host = document.createElement('div');
  host.id = HOST_ID;
  // 'closed' so page scripts cannot reach host.shadowRoot and read the
  // generated password before the user explicitly inserts it. We keep the only
  // reference to the root in this closure.
  const root = host.attachShadow({ mode: 'closed' });

  // Isolated styles inside the shadow root.
  let cssText = '';
  try {
    const res = await fetch(chrome.runtime.getURL('src/ui/panel.css'));
    cssText = await res.text();
  } catch {
    /* styles are cosmetic; panel still functions unstyled */
  }
  const style = document.createElement('style');
  style.textContent = cssText;
  root.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = panelTemplate();
  root.appendChild(wrapper);
  (document.body || document.documentElement).appendChild(host);

  const panel = root.querySelector('.cpg-panel');
  // Right-to-left layout for RTL locales (Arabic, Persian). Chrome's special
  // @@bidi_dir message resolves to 'rtl' or 'ltr' based on the active locale.
  let bidiDir = 'ltr';
  try {
    bidiDir = chrome.i18n.getMessage('@@bidi_dir') || 'ltr';
  } catch {
    /* default ltr */
  }
  panel.setAttribute('dir', bidiDir);

  const output = root.getElementById('cpg-output');
  const slider = root.getElementById('cpg-length-slider');
  const lengthNum = root.getElementById('cpg-length-num');
  const errorEl = root.querySelector('.cpg-error');
  const toastEl = root.querySelector('.cpg-toast');
  const strengthFill = root.querySelector('.cpg-strength-fill');
  const strengthLabel = root.querySelector('.cpg-strength-label');

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 1600);
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  }

  function refreshStrength(password, cfg) {
    const { level, percent } = evaluateStrength(password, getPoolSize(cfg));
    strengthFill.style.width = `${percent}%`;
    strengthFill.style.background = level.color;
    strengthLabel.textContent = t(level.key, level.key);
    strengthLabel.style.color = level.color;
  }

  function regenerate() {
    const cfg = readConfig(root);
    try {
      validateConfig(cfg);
      const pw = generatePassword(cfg);
      output.value = pw;
      showError('');
      refreshStrength(pw, cfg);
    } catch (err) {
      output.value = '';
      strengthFill.style.width = '0%';
      strengthLabel.textContent = '';
      const map = {
        NO_CATEGORY: t('errorNoCategory', 'Select at least one character type.'),
        LENGTH_TOO_SHORT: t('errorLengthShort', 'Increase length to fit all selected types.'),
        INVALID_LENGTH: t('errorLength', 'Length must be between 4 and 128.')
      };
      showError(map[err.code] || t('errorGeneric', 'Could not generate a password.'));
    }
  }

  // Enforce "at least one category" without silently fighting the user: if they
  // uncheck the last one, re-check it.
  function enforceAtLeastOne(changed) {
    const cats = ['uppercase', 'lowercase', 'numbers', 'symbols'];
    const anyOn = cats.some((c) => root.querySelector(`[data-opt="${c}"]`).checked);
    if (!anyOn) {
      root.querySelector(`[data-opt="${changed}"]`).checked = true;
      toast(t('errorNoCategory', 'Select at least one character type.'));
      return false;
    }
    return true;
  }

  async function persist() {
    await savePreferences(readConfig(root));
  }

  function clampLength(value) {
    let n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) n = 20;
    return Math.min(128, Math.max(4, n));
  }

  // --- wire controls -------------------------------------------------------
  slider.addEventListener('input', () => {
    lengthNum.value = slider.value;
    regenerate();
  });
  slider.addEventListener('change', persist);

  lengthNum.addEventListener('input', () => {
    // Keep slider synced live; defer hard clamping to blur so typing feels ok.
    const raw = Number.parseInt(lengthNum.value, 10);
    if (Number.isFinite(raw)) {
      slider.value = String(Math.min(128, Math.max(4, raw)));
      regenerate();
    }
  });
  lengthNum.addEventListener('change', () => {
    lengthNum.value = String(clampLength(lengthNum.value));
    slider.value = lengthNum.value;
    regenerate();
    persist();
  });

  root.querySelectorAll('[data-opt]').forEach((box) => {
    box.addEventListener('change', () => {
      const opt = box.getAttribute('data-opt');
      if (['uppercase', 'lowercase', 'numbers', 'symbols'].includes(opt)) {
        if (!enforceAtLeastOne(opt)) return;
      }
      regenerate();
      persist();
    });
  });

  // --- actions -------------------------------------------------------------
  panel.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');

    if (action === 'close') {
      closePanel();
    } else if (action === 'regenerate') {
      regenerate();
    } else if (action === 'toggle') {
      const show = output.type === 'password';
      output.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
    } else if (action === 'toggle-options') {
      const optionsEl = root.getElementById('cpg-options');
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      optionsEl.hidden = expanded;
      // Grow/shrink in place; only nudge back into view if it now overflows.
      if (active) clampIntoView(panel);
    } else if (action === 'copy') {
      if (!output.value) return;
      const ok = await copyToClipboard(output.value);
      toast(ok ? t('copied', 'Copied!') : t('copyFailed', 'Copy failed'));
    } else if (action === 'insert') {
      if (!output.value) return;
      if (!target) {
        showError(t('errorNoTarget', 'No editable field selected. Right-click a field to insert.'));
        return;
      }
      const ok = insertIntoTarget(target, output.value);
      if (ok) {
        closePanel();
      } else {
        showError(t('errorInsert', 'The target field is no longer available.'));
      }
    }
  });

  // --- dragging (move the panel by its header) -----------------------------
  const header = root.querySelector('.cpg-header');
  let userMoved = false; // once dragged, stop auto-repositioning
  let dragging = false;
  let dragOffX = 0;
  let dragOffY = 0;
  header.addEventListener('pointerdown', (event) => {
    // Don't start a drag from the close button.
    if (event.button !== 0 || event.target.closest('[data-action="close"]')) return;
    dragging = true;
    userMoved = true;
    const rect = panel.getBoundingClientRect();
    dragOffX = event.clientX - rect.left;
    dragOffY = event.clientY - rect.top;
    try {
      header.setPointerCapture(event.pointerId);
    } catch {
      /* no pointer capture available */
    }
    event.preventDefault();
  });
  header.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const left = Math.max(4, Math.min(event.clientX - dragOffX, vw - pw - 4));
    const top = Math.max(4, Math.min(event.clientY - dragOffY, vh - ph - 4));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  });
  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    try {
      header.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };
  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);

  // --- global interactions -------------------------------------------------
  const onOutside = (event) => {
    if (!event.composedPath().includes(host)) closePanel();
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closePanel();
    }
  };
  const onReposition = () => {
    // Keep anchored to the field until the user drags the panel themselves.
    if (active && !userMoved) positionPanel(panel, target);
  };

  active = { host, onOutside, onKeydown, onReposition };
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', onReposition, true);
  window.addEventListener('scroll', onReposition, true);

  // --- initialize ----------------------------------------------------------
  const prefs = await loadPreferences();
  if (!active) return; // closed while awaiting
  writeConfig(root, prefs);
  regenerate();
  positionPanel(panel, target);
  output.focus();
}
