import { describe, expect, it } from 'vitest';
import { Driver, cfg } from './helpers';
import { EngineError } from '../src/scoring';

/** Open Play time-up rules (owner decision 2026-11-11): the side ahead wins the moment time is up; level → pick the winner or the next rally decides. */
const singles = () => new Driver(cfg('singles', { pointsToWin: 11 }));
/** Singles: A serves, A, A, then B wins a rally (side out) and B scores twice → 2-2 with B serving. */
const level = () => { const d = singles().start('A').rallies('AA'); d.rally('B'); d.rally('B'); d.rally('B'); return d; };

describe('TIME_UP', () => {
  it('the side ahead wins on the spot, read from the score (no final rally)', () => {
    const d = singles().start('A').rallies('AAA'); // A 3-0
    d.do('TIME_UP');
    expect(d.state.timeUp).toBe(true);
    expect(d.state.phase).toBe('match_over'); expect(d.state.winner).toBe('A'); expect(d.state.decidedBy).toBe('time');
    expect(d.view.score).toEqual({ A: 3, B: 0 });
    expect(() => d.do('TIME_UP')).toThrow(EngineError); // already decided
  });

  it('a level score waits: the game stays open and the next rally decides unless a winner is picked', () => {
    const d = level();
    expect(d.view.score).toEqual({ A: 2, B: 2 });
    d.do('TIME_UP');
    expect(d.state.phase).toBe('playing'); expect(d.state.winner).toBeNull(); expect(d.state.timeUp).toBe(true); expect(d.state.suddenDeath).toBe(true);
    d.rally('A'); // B is serving and A (receiving) wins the rally: no point scored normally, but this rally decides
    expect(d.state.winner).toBe('A'); expect(d.state.decidedBy).toBe('tiebreak'); expect(d.view.score).toEqual({ A: 3, B: 2 });
  });

  it('a level game can instead be decided by picking the winner (and that can be undone)', () => {
    const d = level(); d.do('TIME_UP');
    d.do('RECORD_RESULT', { winner: 'B' });
    expect(d.state.winner).toBe('B'); expect(d.state.decidedBy).toBe('result'); expect(d.view.score).toEqual({ A: 2, B: 2 });
    d.do('UNDO');
    expect(d.state.phase).toBe('playing'); expect(d.state.winner).toBeNull(); expect(d.state.timeUp).toBe(true);
    expect(d.replayed()).toEqual(d.state);
  });

  it('works in doubles side-out and replays identically', () => {
    const d = new Driver(cfg('doubles')).start('A'); d.rallies('AAB'); d.do('TIME_UP');
    expect(d.state.timeUp).toBe(true);
    expect(d.replayed()).toEqual(d.state);
  });
});

describe('RECORD_RESULT', () => {
  it('finishes the game at the current score, for the leader', () => {
    const d = singles().start('A').rallies('AAAB'); // A 3-0 then side out
    d.do('RECORD_RESULT', {});
    expect(d.state.winner).toBe('A'); expect(d.state.decidedBy).toBe('result'); expect(d.view.score).toEqual({ A: 3, B: 0 });
  });
  it('accepts an entered score and refuses a level score without a winner', () => {
    const d = singles().start('A');
    expect(() => d.do('RECORD_RESULT', {})).toThrowError(/level/);
    d.do('RECORD_RESULT', { scoreA: 7, scoreB: 11 });
    expect(d.state.winner).toBe('B'); expect(d.view.score).toEqual({ A: 7, B: 11 });
  });
  it('lets the winner be chosen when the score is level, and can be undone', () => {
    const d = singles().start('A').rallies('AA'); d.rally('B'); d.rally('B'); d.rally('B'); // 2-2? see above
    d.do('RECORD_RESULT', { winner: 'B' });
    expect(d.state.winner).toBe('B');
    d.do('UNDO');
    expect(d.state.phase).toBe('playing'); expect(d.state.winner).toBeNull();
  });
  it('is not allowed before the match starts or when paused', () => {
    expect(() => singles().do('RECORD_RESULT', { scoreA: 1, scoreB: 0 })).toThrow(EngineError);
    const d = singles().start('A').do('PAUSE');
    expect(() => d.do('RECORD_RESULT', { scoreA: 1, scoreB: 0 })).toThrow(EngineError);
  });
});
