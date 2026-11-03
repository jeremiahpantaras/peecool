import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64;

/** NFR-SEC-01: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string, params = { N, r: R, p: P }): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, { N: params.N, r: params.r, p: params.p, maxmem: 128 * params.N * params.r * 2 });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');
export const sha256Hex = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');
export const randomSecret = (): string => crypto.randomBytes(32).toString('hex');
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
