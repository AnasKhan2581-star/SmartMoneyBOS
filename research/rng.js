/*
 * The random numbers for research controls, shuffles and bootstraps: mulberry32, a 32-bit generator with a full
 * 2^32 period. Use it instead of `seed = (seed * 1103515245 + 12345) >>> 0` and its `% 2^31` / `& 0x7fffffff`
 * variants, which many labs here used until Nov 2026. In JavaScript that product runs past 2^53, so its low bits
 * are rounded away and the sequence falls into a loop: 419 values after 4–15 thousand draws for most seeds (10,466
 * for the other two forms). A "random times" control or a bootstrap drawn from it reuses the same few hundred
 * numbers over and over.
 *   const { mulberry32 } = require('../rng.js'); const rnd = mulberry32(42); rnd() // → [0, 1)
 */
'use strict';
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
module.exports = { mulberry32 };
