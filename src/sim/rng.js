// Small seeded PRNG so a run (and the balance bot) is reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // The generator's position, folded into state hashes so a replay that drew a
  // different number of random values is caught at the next checkpoint.
  rng.state = () => a;
  return rng;
}

export class Emitter {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this.handlers.get(type);
    if (list) this.handlers.set(type, list.filter((f) => f !== fn));
  }
  emit(type, payload) {
    const list = this.handlers.get(type);
    if (list) for (const fn of list) fn(payload);
    const any = this.handlers.get('*');
    if (any) for (const fn of any) fn(type, payload);
  }
}
