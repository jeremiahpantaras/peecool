import { useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import type { LiveScores, NextRoundProjection, OpenPlaySessionDto } from '@pickle/shared';
import { courtsStore } from '../../lib/realtime';
import { useStore } from '../../lib/store';

/** Source key for "waiting now" (game ids start at 1). */
export const WAIT = 0;

/** Live scores from the court consoles, so a bracket moves with every point rather than every refetch. */
export function useLiveScores(d: OpenPlaySessionDto): LiveScores {
  const courts = useStore(courtsStore);
  const out: LiveScores = {};
  for (const g of d.currentRound?.games ?? []) {
    const m = courts[g.courtId]?.match;
    if (m && m.id === g.matchId) out[g.id] = { scoreA: m.games[0]?.scoreA ?? 0, scoreB: m.games[0]?.scoreB ?? 0 };
  }
  return out;
}

export type EdgeKind = 'won' | 'lost' | 'wait' | 'mixed';
export interface LinkSource { key: number; /** the result is final (or the player is waiting) */ solid: boolean; kind: EdgeKind }
export interface Link { gi: number; sources: LinkSource[] }

/**
 * Which sources feed which projected game. Games that are not decided yet draw no line (their players are tagged instead),
 * which keeps the diagram readable.
 */
export function buildLinks(proj: NextRoundProjection | null): Link[] {
  return (proj?.games ?? []).map((g, gi) => {
    const m = new Map<number, { solid: boolean; outcomes: Set<string> }>();
    for (const p of [...g.teamA, ...g.teamB]) {
      if (p.from?.state === 'pending') continue;
      const key = p.from?.gameId ?? WAIT;
      const e = m.get(key) ?? { solid: true, outcomes: new Set<string>() };
      if (p.from && p.from.state !== 'final') e.solid = false;
      e.outcomes.add(p.from ? (p.from.outcome ?? 'none') : 'wait');
      m.set(key, e);
    }
    return { gi, sources: [...m.entries()].map(([key, e]): LinkSource => ({ key, solid: e.solid, kind: key === WAIT ? 'wait' : e.outcomes.size === 1 ? (e.outcomes.has('won') ? 'won' : e.outcomes.has('lost') ? 'lost' : 'mixed') : 'mixed' })) };
  });
}

/** Position of `el` inside `root` in layout pixels. Unlike getBoundingClientRect it ignores CSS transforms (the TV board scales the diagram). */
function within(el: HTMLElement, root: HTMLElement) {
  let x = 0, y = 0; let n: HTMLElement | null = el;
  while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent as HTMLElement | null; }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

export interface Edge { key: string; x1: number; y1: number; x2: number; y2: number; solid: boolean; kind: EdgeKind; lane: number }

/** Measures the source and target elements and returns one edge per link; redraws when the layout or `redraw` changes. `wrap` must be `position: relative`. */
export function useConnectors(wrap: RefObject<HTMLElement | null>, links: Link[], redraw: unknown, src: MutableRefObject<Map<number, HTMLElement>>, tgt: MutableRefObject<Map<number, HTMLElement>>, scaleKey = 1): Edge[] {
  const [edges, setEdges] = useState<Edge[]>([]);
  useLayoutEffect(() => {
    const draw = () => {
      const box = wrap.current; if (!box || box.offsetParent === null) { setEdges([]); return; }
      const out: Edge[] = []; const lane = new Map<number, number>();
      for (const { gi, sources } of links) {
        const t = tgt.current.get(gi); if (!t) continue;
        const tr = within(t, box);
        for (const s of sources) {
          const se = src.current.get(s.key); if (!se) continue;
          const sr = within(se, box);
          const x1 = sr.x + sr.w, y1 = sr.y + sr.h / 2, x2 = tr.x, y2 = tr.y + tr.h / 2;
          if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
          const n = lane.get(s.key) ?? 0; lane.set(s.key, n + 1);
          out.push({ key: `${s.key}-${gi}`, x1, y1, x2, y2, solid: s.solid, kind: s.kind, lane: n });
        }
      }
      setEdges(out);
    };
    draw();
    const raf = requestAnimationFrame(draw); // once more after the layout settles (the TV board rescales itself while it measures)
    const ro = new ResizeObserver(draw); if (wrap.current) ro.observe(wrap.current);
    window.addEventListener('resize', draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('resize', draw); };
  }, [links, redraw, scaleKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return edges;
}

/** Scales its content down (never up) so it fits the remaining screen height: a TV board must not scroll. */
export function FitHeight({ children, minScale = 0.5, onScale }: { children: ReactNode; minScale?: number; onScale?: (k: number) => void }) {
  const outer = useRef<HTMLDivElement>(null); const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ k: number; h?: number }>({ k: 1 });
  useLayoutEffect(() => {
    const run = () => {
      const o = outer.current, i = inner.current; if (!o || !i) return;
      const avail = window.innerHeight - (o.getBoundingClientRect().top + window.scrollY) - 24;
      const natural = i.offsetHeight; // layout height, not affected by the transform
      const k = Math.max(minScale, Math.min(1, avail / natural));
      setFit((p) => (Math.abs(p.k - k) > 0.01 || p.h === undefined ? { k, h: natural * k } : p));
    };
    run();
    const ro = new ResizeObserver(run); if (inner.current) ro.observe(inner.current);
    window.addEventListener('resize', run);
    return () => { ro.disconnect(); window.removeEventListener('resize', run); };
  }, [minScale]);
  useLayoutEffect(() => { onScale?.(fit.k); }, [fit.k]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={outer} style={{ height: fit.h }}><div ref={inner} style={{ transform: `scale(${fit.k})`, transformOrigin: 'top left', width: `${100 / fit.k}%` }}>{children}</div></div>;
}
