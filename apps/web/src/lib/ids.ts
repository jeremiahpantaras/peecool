/** Insecure-context safe (plain HTTP on the LAN): no crypto.randomUUID. */
export function randomId(bytes = 16): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  let s = '';
  a.forEach((b) => { s += b.toString(36).padStart(2, '0'); });
  return s.replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
}
export const newCommandId = (): string => `c${randomId(14)}`.padEnd(20, '0').slice(0, 40);
