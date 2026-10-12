/**
 * Persistent user preferences (chrome.storage.local).
 *
 * SECURITY: stores generator *preferences only*. Never stores generated
 * passwords, password history, credentials, or any entered form values.
 */

const STORAGE_KEY = 'cpg_preferences';

/** Default generator configuration (also the shape of a valid prefs object). */
export const DEFAULT_PREFERENCES = Object.freeze({
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false
});

/** Coerce arbitrary stored data into a safe, fully-populated preferences object. */
export function normalizePreferences(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  let length = Number.parseInt(p.length, 10);
  if (!Number.isFinite(length)) length = DEFAULT_PREFERENCES.length;
  length = Math.min(128, Math.max(4, length));

  const normalized = {
    length,
    uppercase: typeof p.uppercase === 'boolean' ? p.uppercase : DEFAULT_PREFERENCES.uppercase,
    lowercase: typeof p.lowercase === 'boolean' ? p.lowercase : DEFAULT_PREFERENCES.lowercase,
    numbers: typeof p.numbers === 'boolean' ? p.numbers : DEFAULT_PREFERENCES.numbers,
    symbols: typeof p.symbols === 'boolean' ? p.symbols : DEFAULT_PREFERENCES.symbols,
    excludeAmbiguous:
      typeof p.excludeAmbiguous === 'boolean'
        ? p.excludeAmbiguous
        : DEFAULT_PREFERENCES.excludeAmbiguous
  };

  // Enforce the invariant that at least one category stays enabled.
  if (!normalized.uppercase && !normalized.lowercase && !normalized.numbers && !normalized.symbols) {
    normalized.lowercase = true;
  }
  return normalized;
}

/** Load the saved configuration, falling back to defaults on any failure. */
export async function loadPreferences() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return normalizePreferences(result[STORAGE_KEY]);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** Persist the configuration. Returns true on success, false otherwise. */
export async function savePreferences(preferences) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: normalizePreferences(preferences) });
    return true;
  } catch {
    return false;
  }
}

export { STORAGE_KEY };
