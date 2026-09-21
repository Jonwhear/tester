/** Stable-ish unique id generator that works without `crypto.randomUUID`. */
export function createId(prefix = 'id'): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${prefix}_${cryptoObj.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
