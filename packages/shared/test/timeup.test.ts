import { describe, expect, it } from 'vitest';
import { Driver, cfg } from './helpers';
import { EngineError } from '../src/scoring';

/** Open Play time-up rules (plan R15–R18): final rally, then higher score wins; level → next rally won decides. */
const singles = () => new Driver(cfg('singles', { pointsToWin: 11 }));

describe('TIME_UP', () => {
  it('flags the game but does not end it', () => {
    const d = singles().start('A').rallies('AAB');
    d.do('TIME_UP');
    expect(d.state.timeUp).toBe(true);
    expect(d.state.status).toBe('in_progress'); expect(d.state.phase).toBe('playing');
    expect(() => d.do('TIME_UP')).toThrow(EngineError);
  });

  it('the final rally decides for the leader (point scored)', () => {
    const d = singles().start('A').rallies('AAA'); // A 3-0
    d.do('TIME_UP'); d.rally('A');
    expect(d.state.phase).toBe('match_over'); expect(d.state.winner).toBe('A'); expect(d.state.decidedBy).toBe('time');
    expect(d.view.score).toEqual({ A: 4, B: 0 });
  });

  it('the final rally decides for the leader even when the rally scores nothing (side out)', () => {
    const d = singles().start('A').rallies('AAA'); // A 3-0, A serving
    d.do('TIME_UP'); d.rally('B'); // receiving team wins the rally: no point
    expect(d.state.winner).toBe('A'); expect(d.view.score).toEqual({ A: 3, B: 0 }); expect(d.state.decidedBy).toBe('time');
  });

  it('level after the final rally → sudden death: the next rally won decides, whoever served', () => {
    const d = singles().start('A').rallies('AA'); // A 2-0 serving
    d.rally('B'); d.rally('B'); d.rally('B'); // side out to B, B scores twice → 2-2? (A serves→B wins=side out; B serves, B scores 2)
    expect(d.view.score).toEqual({ A: 2, B: 2 });
    d.do('TIME_UP');
    d.rally('A'); // B serving, A wins rally → side out, still level
    expect(d.state.phase).toBe('playing'); expect(d.state.suddenDeath).toBe(true);
    d.rally('B'); // A is serving; B (receiving) wins the rally → B takes the game anyway
    expect(d.state.winner).toBe('B'); expect(d.state.decidedBy).toBe('tiebreak'); expect(d.view.score).toEqual({ A: 2, B: 3 });
  });

  it('undoing the deciding rally reopens the game and keeps the time-up flag', () => {
    const d = singles().start('A').rallies('AAA'); d.do('TIME_UP'); d.rally('A');
    expect(d.state.phase).toBe('match_over');
    d.do('UNDO');
    expect(d.state.phase).toBe('playing'); expect(d.state.timeUp).toBe(true); expect(d.state.winner).toBeNull(); expect(d.view.score.A).toBe(3);
    expect(d.replayed()).toEqual(d.state);
  });

  it('works in doubles side-out and replays identically', () => {
    const d = new Driver(cfg('doubles')).start('A'); d.rallies('AAB'); d.do('TIME_UP'); d.rally('A');
    expect(d.state.winner).toBe('A'); expect(d.replayed()).toEqual(d.state);
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
