/** Server-clock offset (FR-TIMER-03): timers render from server timestamps + offset, never a client stopwatch. */
const samples: number[] = [];
let offset = 0;
export function addClockSample(serverTime: number, sentAt?: number, receivedAt?: number): void {
  const local = sentAt != null && receivedAt != null ? (sentAt + receivedAt) / 2 : Date.now();
  samples.push(serverTime - local);
  if (samples.length > 5) samples.shift();
  const s = [...samples].sort((a, b) => a - b);
  offset = s[Math.floor(s.length / 2)] ?? 0;
}
export const serverNow = (): number => Date.now() + offset;
export const clockOffset = (): number => offset;
