import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Driver, cfg } from './helpers';
import { EngineError, isGameWonBy, elapsedMs, occupiedMs } from '../src/scoring';
import { DEFAULT_RULES } from '../src/constants';

const doubles = () => new Driver(cfg('doubles'));

describe('doubles side-out start (T-DBL-START)', () => {
  it('T-DBL-START-01 starts 0-0-2 with the first server on the right', () => {
    const d = doubles().start('A', { startRight: { A: 2, B: 1 } });
    expect(d.call).toBe('0-0-2');
    expect(d.state.serverSlot).toBe(2);
    expect(d.view.serviceCourt).toBe('right');
  });
  it('T-DBL-START-02 both_servers variant starts 0-0-1 and first fault gives server 2', () => {
    const d = new Driver(cfg('doubles', { firstServerRule: 'both_servers' })).start('A');
    expect(d.call).toBe('0-0-1');
    d.rally('B');
    expect(d.state.servingTeam).toBe('A');
    expect(d.call).toBe('0-0-2');
    expect(d.state.serverSlot).toBe(2);
  });
  it('T-DBL-START-03 first fault at 0-0-2 is an immediate side out to the other team', () => {
    const d = doubles().start('A');
    d.rally('B');
    expect(d.state.servingTeam).toBe('B');
    expect(d.call).toBe('0-0-1');
    expect(d.state.serverSlot).toBe(1);
  });
});

describe('worked example T-DBL-SEQ-01', () => {
  const rows: [string, string, string, number, number, 'A' | 'B', number][] = [
    // winner, outcome, call, scoreA, scoreB, serving, serverNo
    ['A', 'point', '1-0-2', 1, 0, 'A', 2],
    ['B', 'side_out', '0-1-1', 1, 0, 'B', 1],
    ['B', 'point', '1-1-1', 1, 1, 'B', 1],
    ['A', 'second_server', '1-1-2', 1, 1, 'B', 2],
    ['B', 'point', '2-1-2', 1, 2, 'B', 2],
    ['A', 'side_out', '1-2-1', 1, 2, 'A', 1],
    ['A', 'point', '2-2-1', 2, 2, 'A', 1],
    ['B', 'second_server', '2-2-2', 2, 2, 'A', 2],
  ];
  it('matches every row', () => {
    const d = doubles().start('A');
    expect(d.call).toBe('0-0-2');
    for (const [w, outcome, call, a, b, serving, no] of rows) {
      d.rally(w as 'A' | 'B');
      expect(d.state.lastAction?.outcome, call).toBe(outcome);
      expect(d.call).toBe(call);
      expect(d.view.score).toEqual({ A: a, B: b });
      expect(d.state.servingTeam).toBe(serving);
      expect(d.state.serverNumber).toBe(no);
    }
  });
  it('tracks the named server through the sequence (A1 right, B1 right at start)', () => {
    const d = doubles().start('A');
    expect(d.state.serverSlot).toBe(1); // A1 serves from the right
    d.rally('A');
    expect(d.view.serviceCourt).toBe('left'); // score 1 → A1 now on the left
    d.rally('B'); // side out → B1 right (B score 0)
    expect([d.state.servingTeam, d.state.serverSlot, d.view.serviceCourt]).toEqual(['B', 1, 'right']);
    d.rally('B'); // 1-1
    d.rally('A'); // second server B2, B score 1 odd → B2 stands right
    expect([d.state.serverSlot, d.view.serviceCourt]).toEqual([2, 'right']);
    d.rally('B'); d.rally('A'); // side out to A: A score 1 odd → A2 is right
    expect([d.state.servingTeam, d.state.serverNumber, d.state.serverSlot]).toEqual(['A', 1, 2]);
  });
});

describe('positions (T-DBL-POS)', () => {
  it('T-DBL-POS-01 server alternates court as the serving team scores', () => {
    const d = doubles().start('A');
    const courts: string[] = [d.view.serviceCourt!];
    for (let i = 0; i < 3; i++) { d.rally('A'); courts.push(d.view.serviceCourt!); }
    expect(courts).toEqual(['right', 'left', 'right', 'left']);
  });
  it('T-DBL-POS-02 receiving team positions never change while receiving', () => {
    const d = doubles().start('A');
    const before = d.view.rightSlot!.B;
    d.rallies('AAA');
    expect(d.view.rightSlot!.B).toBe(before);
  });
});

describe('singles', () => {
  it('has no server number; server court follows the serving score', () => {
    const d = new Driver(cfg('singles')).start('A');
    expect(d.call).toBe('0-0');
    expect(d.state.serverNumber).toBeNull();
    d.rally('A');
    expect(d.view.serviceCourt).toBe('left');
    expect(d.call).toBe('1-0');
    d.rally('B');
    expect(d.state.servingTeam).toBe('B');
    expect(d.call).toBe('0-1');
  });
  it('only the serving team scores in side-out play', () => {
    const d = new Driver(cfg('singles')).start('A');
    d.rally('B'); // receiving team wins the rally → side out, no point
    expect(d.view.score).toEqual({ A: 0, B: 0 });
    expect(d.state.servingTeam).toBe('B');
    d.rallies('BB'); // now B serves and scores
    expect(d.view.score).toEqual({ A: 0, B: 2 });
  });
});

describe('game and match completion', () => {
  it('wins at 11 by 2 and finishes a single-game match', () => {
    const d = new Driver(cfg('singles')).start('A');
    d.rallies('AAAAAAAAAA'); // 10-0
    expect(d.state.phase).toBe('playing');
    d.rally('A');
    expect(d.state.phase).toBe('match_over');
    expect(d.state.winner).toBe('A');
    expect(d.state.lastAction?.outcome).toBe('match_won');
    expect(d.state.timer.endedAt).not.toBeNull();
  });
  it('requires win by 2 (10-10 continues)', () => {
    const d = new Driver(cfg('singles', { winBy: 2 })).start('A');
    for (let i = 0; i < 10; i++) { d.rally('A'); d.rally('B'); d.rally('B'); d.rally('A'); d.state.servingTeam; }
    expect(d.state.phase).not.toBe('match_over');
  });
  it('isGameWonBy honours win-by and the point cap', () => {
    const r = { ...DEFAULT_RULES, pointCap: 15 };
    expect(isGameWonBy({ A: 11, B: 10 }, 'A', 11, r)).toBe(false);
    expect(isGameWonBy({ A: 12, B: 10 }, 'A', 11, r)).toBe(true);
    expect(isGameWonBy({ A: 15, B: 14 }, 'A', 11, r)).toBe(true);
    expect(isGameWonBy({ A: 11, B: 10 }, 'A', 11, { ...DEFAULT_RULES, winBy: 1 })).toBe(true);
  });
  it('best of 3 with a different deciding-game target', () => {
    const d = new Driver(cfg('singles', { gamesToWin: 2, decidingGamePoints: 15 })).start('A');
    d.rallies('AAAAAAAAAAA');
    expect(d.state.phase).toBe('game_over');
    d.do('START_NEXT_GAME', { servingTeam: 'B' });
    expect(d.state.games[1]!.target).toBe(11);
    d.rallies('BBBBBBBBBBB');
    expect(d.state.phase).toBe('game_over');
    expect(d.state.gamesWon).toEqual({ A: 1, B: 1 });
    d.do('START_NEXT_GAME', { servingTeam: 'A' });
    expect(d.state.games[2]!.target).toBe(15);
    expect(d.view.isDecidingGame).toBe(true);
  });
  it('START_NEXT_GAME with swapDisplay flips the left team', () => {
    const d = new Driver(cfg('singles', { gamesToWin: 2 })).start('A');
    d.rallies('AAAAAAAAAAA');
    d.do('START_NEXT_GAME', { servingTeam: 'B', swapDisplay: true });
    expect(d.state.leftTeam).toBe('B');
  });
});

describe('rally scoring and serving off', () => {
  it('rally scoring: every rally scores; serve passes to the winner', () => {
    const d = new Driver(cfg('doubles', { scoringType: 'rally', pointsToWin: 21 })).start('A');
    d.rally('B');
    expect(d.view.score).toEqual({ A: 0, B: 1 });
    expect(d.state.servingTeam).toBe('B');
    expect(d.state.lastAction?.outcome).toBe('point_side_out');
    expect(d.state.serverNumber).toBeNull();
    expect(d.call).toBe('1-0');
  });
  it('T-OFF-01 serving off: no serving state at all, call is A-B', () => {
    const d = new Driver(cfg('doubles', { scoringType: 'rally', servingMode: 'off' })).start(undefined);
    d.rally('B'); d.rally('B'); d.rally('A');
    expect(d.state.servingTeam).toBeNull();
    expect(d.state.serverSlot).toBeNull();
    expect(d.view.serviceCourt).toBeNull();
    expect(d.call).toBe('1-2');
  });
  it('T-OFF-02 START_MATCH rejects servingTeam when serving is off, and requires it when auto', () => {
    expect(() => new Driver(cfg('singles', { scoringType: 'rally', servingMode: 'off' })).start('A')).toThrow(EngineError);
    expect(() => new Driver(cfg('singles')).start(undefined)).toThrow(EngineError);
  });
});

describe('undo (replay)', () => {
  it('undoes a rally and restores server/score, repeatedly down to the start', () => {
    const d = doubles().start('A');
    d.rallies('ABBA');
    const afterTwo = (() => { const x = doubles().start('A'); x.rallies('AB'); return x.state; })();
    d.do('UNDO'); d.do('UNDO');
    expect(d.view.score).toEqual(afterTwo.games[0]!.score);
    expect([d.state.servingTeam, d.state.serverNumber, d.state.serverSlot]).toEqual([afterTwo.servingTeam, afterTwo.serverNumber, afterTwo.serverSlot]);
    d.do('UNDO'); d.do('UNDO');
    expect(d.call).toBe('0-0-2');
    expect(() => d.do('UNDO')).toThrowError(/Nothing to undo/);
  });
  it('undoing the deciding rally reverts match_over', () => {
    const d = new Driver(cfg('singles')).start('A');
    d.rallies('AAAAAAAAAAA');
    expect(d.state.phase).toBe('match_over');
    d.do('UNDO');
    expect(d.state.phase).toBe('playing');
    expect(d.state.winner).toBeNull();
    expect(d.state.timer.endedAt).toBeNull();
    expect(d.view.score.A).toBe(10);
  });
  it('undoing START_NEXT_GAME returns to game_over', () => {
    const d = new Driver(cfg('singles', { gamesToWin: 2 })).start('A');
    d.rallies('AAAAAAAAAAA');
    d.do('START_NEXT_GAME', { servingTeam: 'B' });
    d.do('UNDO');
    expect(d.state.phase).toBe('game_over');
    expect(d.state.games).toHaveLength(1);
  });
  it('cannot undo while paused or after completion', () => {
    const d = new Driver(cfg('singles')).start('A').rally('A').do('PAUSE');
    expect(() => d.do('UNDO')).toThrow(EngineError);
    d.do('RESUME');
    d.do('UNDO');
    expect(d.call).toBe('0-0');
  });
  it('replay of all events equals the incrementally built state', () => {
    const d = doubles().start('A');
    d.rallies('ABABBAAB'); d.do('UNDO'); d.rally('A'); d.do('PAUSE'); d.do('RESUME'); d.do('SWAP_SIDES');
    expect(d.replayed()).toEqual(d.state);
  });
});

describe('adjust score', () => {
  it('sets the score and serving state, and recomputes right-side players', () => {
    const d = doubles().start('A');
    d.do('ADJUST_SCORE', { scoreA: 7, scoreB: 4, servingTeam: 'B', serverNumber: 2, rightSlot: { A: 2, B: 1 } });
    expect(d.view.score).toEqual({ A: 7, B: 4 });
    expect(d.state.servingTeam).toBe('B');
    expect(d.state.serverNumber).toBe(2);
    expect(d.call).toBe('4-7-2');
    expect(d.view.rightSlot).toEqual({ A: 2, B: 1 });
  });
  it('refuses a score that would end the game', () => {
    const d = doubles().start('A');
    expect(() => d.do('ADJUST_SCORE', { scoreA: 11, scoreB: 3, servingTeam: 'A', serverNumber: 1 })).toThrowError(/end the game/);
  });
  it('can be undone', () => {
    const d = doubles().start('A').rally('A');
    d.do('ADJUST_SCORE', { scoreA: 5, scoreB: 5, servingTeam: 'B', serverNumber: 1 });
    d.do('UNDO');
    expect(d.view.score).toEqual({ A: 1, B: 0 });
  });
});

describe('pause / resume / timer', () => {
  it('accumulates paused time and keeps the phase', () => {
    const d = new Driver(cfg('singles')).start('A');
    const t0 = d.state.timer.startedAt!;
    d.t += 5000; d.do('PAUSE');
    expect(d.state.status).toBe('paused');
    expect(() => d.rally('A')).toThrow(EngineError);
    d.t += 10_000; d.do('RESUME');
    expect(d.state.timer.pausedTotalMs).toBe(12_000); // driver adds 1 s per attempted event (incl. the rejected rally)
    expect(d.state.phase).toBe('playing');
    expect(occupiedMs(d.state, d.t + 1000)).toBe(d.t + 1000 - t0);
    expect(elapsedMs(d.state, d.t + 1000)).toBe(d.t + 1000 - t0 - 12_000);
  });
});

describe('END_MATCH (T-END)', () => {
  const end = { reason: 'players_left', confirmed: true };
  it('T-END-01 terminates with no winner even when ahead, preserving scores and abandoning the game', () => {
    const d = new Driver(cfg('singles', { gamesToWin: 2 })).start('A');
    d.rallies('AAAAAAAAAAA'); d.do('START_NEXT_GAME', { servingTeam: 'B' }); d.rallies('BB');
    d.do('END_MATCH', end);
    expect(d.state.status).toBe('terminated');
    expect(d.state.winner).toBeNull();
    expect(d.state.gamesWon).toEqual({ A: 1, B: 0 });
    expect(d.state.games[0]).toMatchObject({ score: { A: 11, B: 0 }, winner: 'A', abandoned: false });
    expect(d.state.games[1]).toMatchObject({ score: { A: 0, B: 2 }, winner: null, abandoned: true });
    expect(d.state.timer.endedAt).toBe(d.t);
    expect(d.state.endReason).toBe('players_left');
  });
  it('T-END-02 works from a paused match and closes the pause', () => {
    const d = new Driver(cfg('singles')).start('A').rally('A').do('PAUSE');
    d.t += 4000;
    d.do('END_MATCH', { reason: 'injury', confirmed: true });
    expect(d.state.status).toBe('terminated');
    expect(d.state.timer.pausedAt).toBeNull();
  });
  it('T-END-03 is allowed from game_over but nothing is abandoned', () => {
    const d = new Driver(cfg('singles', { gamesToWin: 2 })).start('A');
    d.rallies('AAAAAAAAAAA');
    d.do('END_MATCH', { reason: 'time_up', confirmed: true });
    expect(d.state.games.every((g) => !g.abandoned)).toBe(true);
  });
  it('T-END-04 is rejected from setup, match_over, without confirmation, and "other" needs a note', () => {
    const s = new Driver(cfg('singles'));
    expect(() => s.do('END_MATCH', end)).toThrow(EngineError);
    const m = new Driver(cfg('singles')).start('A').rallies('AAAAAAAAAAA');
    expect(() => m.do('END_MATCH', end)).toThrow(EngineError);
    const d = new Driver(cfg('singles')).start('A');
    expect(() => d.do('END_MATCH', { reason: 'injury' })).toThrowError(/confirmed/);
    expect(() => d.do('END_MATCH', { reason: 'other', confirmed: true })).toThrowError(/note/);
    d.do('END_MATCH', { reason: 'other', note: 'Rain', confirmed: true });
    expect(d.state.endNote).toBe('Rain');
  });
  it('T-END-05 is not undoable', () => {
    const d = new Driver(cfg('singles')).start('A').rally('A');
    d.do('END_MATCH', end);
    expect(() => d.do('UNDO')).toThrow(EngineError);
  });
});

describe('admin correction', () => {
  it('turns an ended-early match into a completed one when the scores decide it', () => {
    const d = new Driver(cfg('singles')).start('A').rallies('AAAA');
    d.do('END_MATCH', { reason: 'players_left', confirmed: true });
    d.do('ADMIN_CORRECTION', { games: [{ number: 1, scoreA: 11, scoreB: 7 }], reason: 'Scorer left early' });
    expect(d.state.status).toBe('completed');
    expect(d.state.winner).toBe('A');
  });
  it('rejects scores that decide nothing unless forced with a winner', () => {
    const d = new Driver(cfg('singles')).start('A').rallies('AAAAAAAAAAA');
    d.do('CONFIRM_MATCH_END');
    expect(() => d.do('ADMIN_CORRECTION', { games: [{ number: 1, scoreA: 9, scoreB: 8 }], reason: 'x' })).toThrowError(/valid winner/);
    d.do('ADMIN_CORRECTION', { games: [{ number: 1, scoreA: 9, scoreB: 8, winner: 'B' }], reason: 'forced', force: true });
    expect(d.state.winner).toBe('B');
  });
});

describe('switch ends (§7)', () => {
  it('shows once at the midpoint and clears on the next rally', () => {
    const d = new Driver(cfg('singles')).start('A');
    d.rallies('AAAAA');
    expect(d.state.switchEndsPending).toBe(false);
    d.rally('A');
    expect(d.state.switchEndsPending).toBe(true);
    d.rally('A');
    expect(d.state.switchEndsPending).toBe(false);
  });
  it('deciding_game mode skips non-deciding games of a best-of-3', () => {
    const d = new Driver(cfg('singles', { gamesToWin: 2 })).start('A');
    d.rallies('AAAAAA');
    expect(d.state.switchEndsPending).toBe(false);
  });
});

describe('game point / match point', () => {
  it('flags the serving team on game point in side-out play', () => {
    const d = new Driver(cfg('singles')).start('A').rallies('AAAAAAAAAA');
    expect(d.view.gamePointTeam).toBe('A');
    expect(d.view.matchPointTeam).toBe('A');
  });
  it('is not matchpoint for a non-deciding game of best-of-3', () => {
    const d = new Driver(cfg('singles', { gamesToWin: 2 })).start('A').rallies('AAAAAAAAAA');
    expect(d.view.gamePointTeam).toBe('A');
    expect(d.view.matchPointTeam).toBeNull();
  });
});

describe('invariants (property tests)', () => {
  const modes = [
    cfg('doubles'), cfg('singles'), cfg('doubles', { scoringType: 'rally', pointsToWin: 21 }),
    cfg('singles', { scoringType: 'rally', servingMode: 'off', gamesToWin: 2 }), cfg('doubles', { gamesToWin: 2, winBy: 1 }),
    cfg('doubles', { firstServerRule: 'both_servers', pointCap: 15 }),
  ];
  it('random play keeps state sane and undo = replay without the last event', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: modes.length - 1 }), fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 160 }), (mi, ops) => {
        const c = modes[mi]!;
        const d = new Driver(c);
        d.start(c.rules.servingMode === 'auto' ? 'A' : undefined);
        for (const op of ops) {
          const before = JSON.stringify(d.state);
          try {
            if (d.state.phase === 'game_over') d.do('START_NEXT_GAME', c.rules.servingMode === 'auto' ? { servingTeam: 'B' } : {});
            else if (d.state.phase === 'match_over') break;
            else if (op === 9) d.do('UNDO');
            else if (op === 8) { d.do('PAUSE'); d.do('RESUME'); }
            else d.rally(op % 2 === 0 ? 'A' : 'B');
          } catch (e) {
            if (!(e instanceof EngineError)) throw e;
            expect(JSON.stringify(d.state)).toBe(before);
          }
          const g = d.state.games.at(-1)!;
          expect(g.score.A).toBeGreaterThanOrEqual(0);
          expect(g.score.B).toBeGreaterThanOrEqual(0);
          expect(d.state.gamesWon.A).toBeLessThanOrEqual(c.rules.gamesToWin);
          expect(d.state.gamesWon.B).toBeLessThanOrEqual(c.rules.gamesToWin);
          expect(d.state.games.filter((x) => x.winner == null && !x.abandoned).length).toBeLessThanOrEqual(1);
          expect(d.replayed()).toEqual(d.state);
        }
      }),
      { numRuns: 400 },
    );
  });
  it('in side-out play only the serving team scores', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 80 }), (seq) => {
        const d = new Driver(cfg('doubles')).start('A');
        for (const b of seq) {
          if (d.state.phase !== 'playing') break;
          const before = { ...d.view.score };
          const serving = d.state.servingTeam!;
          const w = b ? 'A' : 'B';
          d.rally(w);
          if (w !== serving && d.state.phase === 'playing') expect(d.view.score).toEqual(before);
        }
      }),
      { numRuns: 300 },
    );
  });
});
