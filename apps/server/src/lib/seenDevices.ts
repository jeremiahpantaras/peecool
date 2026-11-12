/**
 * Which other devices have contacted this server lately (in memory only, never stored). The Connect page shows this so staff can open the
 * address on a phone and see straight away whether the request arrived: if it never appears, the network or the phone is blocking it.
 */
export interface SeenDevice { ip: string; kind: string; lastSeenAt: number; requests: number }

const seen = new Map<string, SeenDevice>();
const MAX = 200;

export const normalizeIp = (ip: string): string => ip.replace(/^::ffff:/, '');
export const isLoopback = (ip: string): boolean => ip === '::1' || ip.startsWith('127.') || ip === 'localhost';

/**
 * The device's real address. Behind the Vite dev proxy every request comes from 127.0.0.1, which sends the original address in
 * X-Forwarded-For; that header is only believed when the direct peer is this computer itself (it cannot be spoofed from the LAN).
 */
export function clientIp(peer: string, forwardedFor: string | string[] | undefined): string {
  const p = normalizeIp(peer);
  const xff = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return isLoopback(p) && xff ? normalizeIp(xff.split(',')[0]!.trim()) : p;
}

/** A short, friendly name from the browser's User-Agent. */
export function deviceKind(ua: string | undefined): string {
  const u = ua ?? '';
  if (/iPhone/i.test(u)) return 'iPhone';
  if (/iPad/i.test(u)) return 'iPad';
  if (/Android/i.test(u)) return /Mobile/i.test(u) ? 'Android phone' : 'Android tablet';
  if (/Windows/i.test(u)) return 'Windows PC';
  if (/Macintosh|Mac OS X/i.test(u)) return 'Mac';
  if (/Linux|CrOS/i.test(u)) return 'Linux / Chromebook';
  return 'Device';
}

export function noteDevice(rawIp: string, ua: string | undefined, now: number): void {
  const ip = normalizeIp(rawIp);
  if (!ip || isLoopback(ip)) return;
  const prev = seen.get(ip);
  seen.set(ip, { ip, kind: ua ? deviceKind(ua) : (prev?.kind ?? 'Device'), lastSeenAt: now, requests: (prev?.requests ?? 0) + 1 });
  if (seen.size > MAX) for (const [k, v] of seen) if (now - v.lastSeenAt > 3_600_000) seen.delete(k);
}

export function recentDevices(now: number, windowMs = 30 * 60_000): SeenDevice[] {
  return [...seen.values()].filter((d) => now - d.lastSeenAt <= windowMs).sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 12);
}

/** Tests only. */
export const clearSeenDevices = (): void => seen.clear();
