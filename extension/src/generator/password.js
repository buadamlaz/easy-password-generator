/**
 * Cryptographically secure password generator.
 *
 * Pure module: no DOM, no chrome.* APIs, no console output. This keeps the
 * generation logic isolated from UI/storage (per the architecture rules) and
 * makes it unit-testable in plain Node (globalThis.crypto is used by default).
 */

export const CHARACTER_SETS = Object.freeze({
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?'
});

/** Characters that are easy to confuse with one another. */
const AMBIGUOUS = new Set(['O', '0', 'I', 'l', '1']);

/** Categories that, when enabled, must each contribute at least one character. */
export const CATEGORY_ORDER = ['uppercase', 'lowercase', 'numbers', 'symbols'];

/**
 * Draw an unbiased integer in [0, max) from a CSPRNG using rejection sampling.
 * Avoids modulo bias by rejecting values in the final, incomplete block of the
 * 32-bit range.
 */
function secureRandomInt(max, cryptoObj) {
  if (max <= 0) throw new RangeError('max must be > 0');
  const range = 0x100000000; // 2^32
  const limit = range - (range % max); // largest multiple of max that fits
  const buf = new Uint32Array(1);
  let value;
  do {
    cryptoObj.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

/** In-place, cryptographically secure Fisher–Yates shuffle. */
function secureShuffle(array, cryptoObj) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1, cryptoObj);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Build the per-category character pools for a configuration, applying the
 * ambiguous-character filter when requested.
 *
 * @returns {{ category: string, chars: string }[]} only non-empty, enabled pools
 */
export function buildPools(config) {
  const pools = [];
  for (const category of CATEGORY_ORDER) {
    if (!config[category]) continue;
    let chars = CHARACTER_SETS[category];
    if (config.excludeAmbiguous) {
      chars = [...chars].filter((c) => !AMBIGUOUS.has(c)).join('');
    }
    if (chars.length > 0) pools.push({ category, chars });
  }
  return pools;
}

/**
 * Validate a configuration. Throws an Error (with a stable `.code`) on failure.
 * Returns the resolved pools so callers don't rebuild them.
 */
export function validateConfig(config) {
  const length = Number(config.length);
  if (!Number.isInteger(length) || length < 4 || length > 128) {
    throw Object.assign(new Error('Length must be an integer between 4 and 128.'), {
      code: 'INVALID_LENGTH'
    });
  }
  const pools = buildPools(config);
  if (pools.length === 0) {
    throw Object.assign(new Error('At least one character category must be enabled.'), {
      code: 'NO_CATEGORY'
    });
  }
  if (length < pools.length) {
    throw Object.assign(
      new Error('Length is too short to include one character from every enabled category.'),
      { code: 'LENGTH_TOO_SHORT' }
    );
  }
  return pools;
}

/**
 * Total number of distinct characters the generator can draw from for a config.
 * Used by the strength estimator to compute entropy.
 */
export function getPoolSize(config) {
  return buildPools(config).reduce((sum, p) => sum + p.chars.length, 0);
}

/**
 * Generate a cryptographically secure password.
 *
 * Guarantees: at least one character from every enabled category, unbiased
 * selection via rejection sampling, and a secure final shuffle.
 *
 * @param {object} config - { length, uppercase, lowercase, numbers, symbols, excludeAmbiguous }
 * @param {Crypto} [cryptoObj=globalThis.crypto] - injectable for testing
 * @returns {string}
 */
export function generatePassword(config, cryptoObj = globalThis.crypto) {
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw Object.assign(new Error('A Web Crypto implementation is required.'), {
      code: 'NO_CRYPTO'
    });
  }
  const pools = validateConfig(config);
  const length = Number(config.length);
  const combined = pools.map((p) => p.chars).join('');

  const chars = [];
  // Guarantee one character from each enabled category.
  for (const pool of pools) {
    chars.push(pool.chars[secureRandomInt(pool.chars.length, cryptoObj)]);
  }
  // Fill the remainder from the combined pool.
  for (let i = chars.length; i < length; i++) {
    chars.push(combined[secureRandomInt(combined.length, cryptoObj)]);
  }
  // Shuffle so the guaranteed characters aren't always at the front.
  secureShuffle(chars, cryptoObj);
  return chars.join('');
}
