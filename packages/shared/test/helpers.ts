import { DEFAULT_RULES } from '../src/constants';
import { applyEvent, createInitialState, deriveView, replay, applyUndo, type EngineEvent, type MatchState } from '../src/scoring';
import type { MatchConfig, MatchRules, PlayType } from '../src/types';

export const cfg = (playType: PlayType, o: Partial<MatchRules> = {}): MatchConfig => ({ playType, rules: { ...DEFAULT_RULES, ...o } });

/** Tiny test driver that mimics the server pipeline (incremental apply + undo via replay). */
export class Driver {
  events: EngineEvent[] = [];
  state: MatchState = createInitialState();
  t = 1_000_000;
  constructor(public c: MatchConfig) {}
  do(type: EngineEvent['type'], payload: Record<string, unknown> = {}): this {
    const seq = this.events.length + 1;
    this.t += 1000;
    if (type === 'UNDO') {
      const r = applyUndo(this.state, this.events, this.c, seq, this.t);
      this.events = this.events.map((e) => (e.seq === r.voided.seq ? { ...e, voidedBy: seq } : e));
      this.events.push(r.undoEvent);
      this.state = r.state;
      return this;
    }
    const ev: EngineEvent = { seq, type, payload, at: this.t };
    this.state = applyEvent(this.state, ev, this.c);
    this.events.push(ev);
    return this;
  }
  start(...args: ['A' | 'B' | undefined] | ['A' | 'B' | undefined, Record<string, unknown>] | []) {
    const servingTeam = args.length === 0 ? 'A' : args[0];
    const extra = (args[1] ?? {}) as Record<string, unknown>;
    return this.do('START_MATCH', servingTeam ? { servingTeam, ...extra } : extra);
  }
  rally(team: 'A' | 'B') { return this.do('RALLY_WON', { team }); }
  rallies(s: string) { for (const ch of s) this.rally(ch as 'A' | 'B'); return this; }
  get view() { return deriveView(this.state, this.c); }
  get call() { return this.view.scoreCall; }
  replayed() { return replay(this.c, this.events); }
}
