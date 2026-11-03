// Deterministic math for the simulation. Runs are verified by replaying them on the
// server, so every number the simulation computes must come out bit-identical in
// every JavaScript engine. +, -, *, / and Math.sqrt are exactly rounded by IEEE 754
// and therefore safe; Math.pow, Math.exp, Math.log, Math.hypot, Math.atan2 and the
// ** operator are left to each engine and can differ in the last bit. The helpers
// below use only the safe operations. `npm run check:sim` keeps the unsafe ones out.

const LN2 = 0.6931471805599453;
const PI = 3.141592653589793;

export const sq = (x) => x * x;
export const dist = (dx, dz) => Math.sqrt(dx * dx + dz * dz);

// 2^k by repeated multiplication (exact until the result leaves the normal range).
function pow2(k) {
  let p = 1;
  const b = k < 0 ? 0.5 : 2;
  for (let i = k < 0 ? -k : k; i > 0; i--) p *= b;
  return p;
}

export function dexp(x) {
  if (x !== x) return NaN;
  if (x > 709.78) return Infinity;
  if (x < -745.2) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2; // |r| <= ~0.35
  let term = 1, sum = 1;
  for (let i = 1; i < 22; i++) { term *= r / i; sum += term; }
  return sum * pow2(k);
}

export function dlog(x) {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  // x = m * 2^e with m in [sqrt(1/2), sqrt(2)); halving and doubling are exact.
  let m = x, e = 0;
  while (m >= 2) { m /= 2; e++; }
  while (m < 1) { m *= 2; e--; }
  if (m > 1.4142135623730951) { m /= 2; e++; }
  // log(m) = 2 atanh(s), s = (m - 1) / (m + 1), |s| <= 0.172
  const s = (m - 1) / (m + 1), s2 = s * s;
  let term = s, sum = 0;
  for (let i = 1; i < 40; i += 2) { sum += term / i; term *= s2; }
  return e * LN2 + 2 * sum;
}

// b^e. Integer exponents multiply exactly the same way everywhere.
export function dpow(b, e) {
  if (Number.isInteger(e) && e >= -1024 && e <= 1024) {
    let r = 1, base = e < 0 ? 1 / b : b;
    for (let n = e < 0 ? -e : e; n > 0; n >>= 1) {
      if (n & 1) r *= base;
      base *= base;
    }
    return r;
  }
  if (b === 0) return e > 0 ? 0 : Infinity;
  if (b < 0) return NaN;
  return dexp(e * dlog(b));
}

function datan(z) {
  if (z !== z) return NaN;
  const neg = z < 0;
  if (neg) z = -z;
  let off = 0;
  if (z > 1) { z = 1 / z; off = PI / 2; }
  // Two half-angle reductions: atan(z) = 2 atan(z / (1 + sqrt(1 + z^2))).
  z = z / (1 + Math.sqrt(1 + z * z));
  z = z / (1 + Math.sqrt(1 + z * z));
  const z2 = z * z;
  let term = z, sum = 0;
  for (let i = 1; i < 40; i += 2) { sum += term / i; term *= -z2; }
  let r = 4 * sum;
  if (off) r = off - r;
  return neg ? -r : r;
}

export function datan2(y, x) {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  if (y > 0) return PI / 2;
  if (y < 0) return -PI / 2;
  return 0;
}
