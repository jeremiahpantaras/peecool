/** The court id is remembered in the browser only as a HINT; the server-side session is the source of truth (FR-TERM-03). */
const KEY = 'ps_last_court';
export interface Hint { courtId: number; courtName: string }
export function getHint(): Hint | null { try { const v = localStorage.getItem(KEY); return v ? (JSON.parse(v) as Hint) : null; } catch { return null; } }
export function setHint(h: Hint | null): void { try { if (h) localStorage.setItem(KEY, JSON.stringify(h)); else localStorage.removeItem(KEY); } catch { /* ignore */ } }
