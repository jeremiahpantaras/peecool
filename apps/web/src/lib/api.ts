import type { ApiErrorBody, CourtSnapshot } from '@pickle/shared';
import { addClockSample } from './clock';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any, public snapshot?: CourtSnapshot, public requestId?: string) {
    super(message);
  }
}

const TIMEOUT_MS = 8000;
let onUnauthenticated: (() => void) | null = null;
export const setUnauthenticatedHandler = (fn: () => void): void => { onUnauthenticated = fn; };

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { timeoutMs?: number; raw?: boolean } = {}): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(path.startsWith('/') ? path : `/api/v1/${path}`, {
      method, credentials: 'same-origin', signal: ctl.signal,
      headers: { 'X-Pickle-Client': '1', ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(0, 'NETWORK', (e as Error).name === 'AbortError' ? 'The server took too long to answer' : "Couldn't reach the Master PC");
  } finally { clearTimeout(timer); }
  const st = res.headers.get('x-server-time');
  if (st) addClockSample(Number(st), t0, Date.now());
  if (res.status === 204) return undefined as T;
  if (opts.raw) { if (!res.ok) throw await toError(res); return (await res.text()) as T; }
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

async function toError(res: Response): Promise<ApiError> {
  let b: ApiErrorBody | null = null;
  try { b = await res.json(); } catch { /* not json */ }
  const err = new ApiError(res.status, b?.error.code ?? 'ERROR', b?.error.message ?? `Request failed (${res.status})`, b?.error.details, b?.snapshot, b?.error.requestId);
  if (res.status === 401 && err.code === 'UNAUTHENTICATED') onUnauthenticated?.();
  return err;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const put = <T = any>(p: string, b: unknown = {}) => api<T>('PUT', p, b);
export const patch = <T = any>(p: string, b: unknown = {}) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function downloadUrl(path: string): void { window.location.href = path.startsWith('/') ? path : `/api/v1/${path}`; }
