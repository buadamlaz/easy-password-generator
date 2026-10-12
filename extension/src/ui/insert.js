/**
 * DOM insertion helpers.
 *
 * Pure DOM only — no chrome.* APIs, no network — so this is unit-testable under
 * jsdom. Dispatches native input/change events so modern frameworks
 * (React/Vue/Angular) register the programmatic change as user input.
 */

/**
 * Input `type`s we must NOT write a password into: either they silently reject
 * arbitrary strings (e.g. `number` resets to "") or they are not text fields.
 */
const UNSUPPORTED_INPUT_TYPES = new Set([
  'number', 'range', 'color', 'date', 'datetime-local', 'month', 'week',
  'time', 'checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'hidden'
]);

/** Can we meaningfully insert a text password into this element right now? */
export function isInsertable(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.disabled || el.readOnly) return false;
  if (!el.isConnected) return false;

  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !UNSUPPORTED_INPUT_TYPES.has(type);
  }
  return Boolean(el.isContentEditable);
}

/**
 * Insert `value` into `target`. Returns true only if the field was writable and
 * the value was applied.
 */
export function insertIntoTarget(target, value) {
  if (!isInsertable(target)) return false;

  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    // Use the prototype's native setter so React's value-tracker treats the
    // following 'input' event as genuine user input.
    if (descriptor && descriptor.set) {
      descriptor.set.call(target, value);
    } else {
      target.value = value;
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // contenteditable
  target.textContent = value;
  target.dispatchEvent(new InputEvent('input', { bubbles: true }));
  return true;
}
