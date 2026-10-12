/**
 * Background service worker (Manifest V3).
 *
 * Responsibilities (kept intentionally tiny — no polling, no timers, no state):
 *  1. Register the "Generate Password" context menu for editable fields.
 *  2. On click, tell the content script in the correct tab/frame to open the
 *     generator panel for the field that was right-clicked.
 */

const MENU_ID = 'cpg-generate-password';

function createMenu() {
  // Remove first so repeated onInstalled/onStartup events can't duplicate it.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: chrome.i18n.getMessage('contextMenuGenerate') || 'Generate Password',
      // "editable" covers <input>, <textarea> and contenteditable elements.
      contexts: ['editable']
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;

  // Target the exact frame the user right-clicked in (frameId may be undefined
  // for the top frame on older Chrome; omit the option in that case).
  const options = typeof info.frameId === 'number' ? { frameId: info.frameId } : undefined;

  chrome.tabs.sendMessage(tab.id, { type: 'CPG_OPEN_PANEL' }, options, () => {
    // Swallow "receiving end does not exist" on restricted pages (chrome://,
    // the Web Store, PDF viewer, etc.) where no content script can run.
    void chrome.runtime.lastError;
  });
});

// Clicking the toolbar icon opens the generator in the active tab. There is no
// right-clicked field here, so the content script falls back to the currently
// focused editable element (if any) for the Insert action.
chrome.action.onClicked.addListener((tab) => {
  if (!tab || tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: 'CPG_OPEN_ACTION' }, () => {
    void chrome.runtime.lastError;
  });
});
