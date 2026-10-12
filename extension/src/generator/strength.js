/**
 * Entropy-based password strength estimation.
 *
 * For *randomly generated* passwords the honest strength measure is Shannon
 * entropy: entropy = length * log2(poolSize), where poolSize is the number of
 * distinct characters the generator could have drawn from. This deliberately
 * does NOT reward pattern-matching heuristics (which are meaningless for random
 * output) and does NOT rely on checkbox count alone — it reflects the actual
 * generation method.
 *
 * Pure module: no DOM, no chrome.* APIs. Unit-testable in plain Node.
 */

/** Strength levels, ordered weakest → strongest. Labels are i18n message keys. */
export const STRENGTH_LEVELS = Object.freeze([
  { index: 0, key: 'strengthVeryWeak', color: '#e5484d' }, // red
  { index: 1, key: 'strengthWeak', color: '#f76b15' }, // orange
  { index: 2, key: 'strengthFair', color: '#f5d90a' }, // yellow
  { index: 3, key: 'strengthStrong', color: '#99d52a' }, // light green
  { index: 4, key: 'strengthVeryStrong', color: '#30a46c' } // green
]);

/**
 * Map entropy (in bits) to a strength level index [0..4].
 * Thresholds follow commonly cited guidance for random secrets.
 */
export function entropyToLevel(entropyBits) {
  if (entropyBits < 28) return 0; // Very Weak
  if (entropyBits < 36) return 1; // Weak
  if (entropyBits < 60) return 2; // Fair
  if (entropyBits < 128) return 3; // Strong
  return 4; // Very Strong
}

/**
 * Evaluate the strength of a generated password.
 *
 * @param {string} password - the generated password
 * @param {number} poolSize - distinct characters the generator could draw from
 * @returns {{ entropyBits: number, levelIndex: number, level: object, percent: number }}
 */
export function evaluateStrength(password, poolSize) {
  const length = typeof password === 'string' ? password.length : 0;
  const size = Number(poolSize);
  const entropyBits =
    length > 0 && size > 1 ? length * Math.log2(size) : 0;
  const levelIndex = entropyToLevel(entropyBits);
  // Map entropy onto a 0–100 bar, treating 128 bits as "full".
  const percent = Math.max(0, Math.min(100, Math.round((entropyBits / 128) * 100)));
  return {
    entropyBits: Math.round(entropyBits * 10) / 10,
    levelIndex,
    level: STRENGTH_LEVELS[levelIndex],
    percent
  };
}
