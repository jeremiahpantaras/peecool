/** Tiny in-memory fixed-window limiter (NFR-SEC-07). */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(private limit: number, private windowMs: number, private now: () => number = Date.now) {}
  /** Returns seconds to wait when over the limit, else 0. */
  hit(key: string): number {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || h.reset <= t) { this.hits.set(key, { count: 1, reset: t + this.windowMs }); return 0; }
    h.count++;
    return h.count > this.limit ? Math.ceil((h.reset - t) / 1000) : 0;
  }
  clear(): void { this.hits.clear(); }
}
