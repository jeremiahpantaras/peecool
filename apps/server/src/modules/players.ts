import type { FastifyInstance } from 'fastify';
import {
  addTypedToDirectorySchema, createPlayerSchema, linkTypedSchema, normalizeForSearch, normalizeTypedName, patchPlayerSchema,
  type Paged, type PlayerListItem,
} from '@pickle/shared';
import type { Ctx } from '../context';
import { E } from '../lib/errors';
import { audit } from '../lib/audit';
import { actorOf } from '../auth';

const typedKey = (name: string) => `t:${encodeURIComponent(name.toLowerCase())}`;

/** DATABASE_SCHEMA §5a — directory ∪ typed names. Stats count completed matches only. */
export function playerIndex(ctx: Ctx, range?: { from: string; to: string }): PlayerListItem[] {
  const rg = range ? ' AND m.play_date BETWEEN @from AND @to' : '';
  const args = range ? { from: range.from, to: range.to } : {};
  const reg = ctx.db.prepare(`SELECT p.id, p.display_name name, p.is_active active,
      COUNT(DISTINCT CASE WHEN m.status = 'completed' THEN m.id END) matches,
      COUNT(DISTINCT CASE WHEN m.status = 'completed' AND m.winner_team = mp.team THEN m.id END) wins,
      COUNT(DISTINCT CASE WHEN m.status = 'completed' AND m.winner_team <> mp.team THEN m.id END) losses,
      MAX(m.started_at) last_played
    FROM players p LEFT JOIN match_players mp ON mp.player_id = p.id
    LEFT JOIN matches m ON m.id = mp.match_id AND m.status IN ('completed','terminated')${rg}
    GROUP BY p.id`).all(args) as { id: number; name: string; active: number; matches: number; wins: number; losses: number; last_played: number | null }[];
  const typed = ctx.db.prepare(`SELECT MIN(mp.display_name) name, lower(mp.display_name) lname,
      COUNT(DISTINCT CASE WHEN m.status = 'completed' THEN m.id END) matches,
      COUNT(DISTINCT CASE WHEN m.status = 'completed' AND m.winner_team = mp.team THEN m.id END) wins,
      COUNT(DISTINCT CASE WHEN m.status = 'completed' AND m.winner_team <> mp.team THEN m.id END) losses,
      MAX(m.started_at) last_played
    FROM match_players mp JOIN matches m ON m.id = mp.match_id AND m.status IN ('completed','terminated')${rg}
    WHERE mp.player_id IS NULL AND mp.display_name IS NOT NULL
    GROUP BY mp.display_name COLLATE NOCASE`).all(args) as { name: string; lname: string; matches: number; wins: number; losses: number; last_played: number | null }[];
  return [
    ...reg.map((r): PlayerListItem => ({ key: `r:${r.id}`, kind: 'registered', playerId: r.id, name: r.name, isActive: !!r.active, matches: r.matches, wins: r.wins, losses: r.losses, lastPlayedAt: r.last_played })),
    ...typed.map((r): PlayerListItem => ({ key: typedKey(r.lname), kind: 'typed', playerId: null, name: r.name, isActive: true, matches: r.matches, wins: r.wins, losses: r.losses, lastPlayedAt: r.last_played })),
  ];
}

interface HistRow { id: number; match_code: string; play_date: string; started_at: number | null; status: string; winner_team: 'A' | 'B' | null; play_type: string; team: 'A' | 'B'; slot: number; court: string }

function parseKey(key: string): { kind: 'registered'; id: number } | { kind: 'typed'; name: string } {
  if (key.startsWith('r:')) { const id = Number(key.slice(2)); if (Number.isInteger(id)) return { kind: 'registered', id }; }
  if (key.startsWith('t:')) return { kind: 'typed', name: decodeURIComponent(key.slice(2)) };
  throw E.notFound('Player not found');
}

export function registerPlayerRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/v1/players/search', { config: { perm: 'players.view' } }, async (req) => {
    const q = req.query as { q?: string; limit?: string };
    const n = normalizeForSearch(q.q ?? '');
    if (n.length < 2) return [];
    const limit = Math.min(20, Number(q.limit ?? 8));
    return ctx.db.prepare(`SELECT id, display_name AS displayName FROM players WHERE is_active = 1 AND normalized_name LIKE ? ORDER BY (normalized_name LIKE ?) DESC, normalized_name LIMIT ?`)
      .all(`%${n}%`, `${n}%`, limit);
  });

  app.get('/api/v1/players', { config: { perm: 'players.view' } }, async (req): Promise<Paged<PlayerListItem>> => {
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page ?? 1)); const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 25)));
    let items = playerIndex(ctx);
    if (q.kind === 'registered' || q.kind === 'typed') items = items.filter((i) => i.kind === q.kind);
    if (q.active === 'true') items = items.filter((i) => i.isActive);
    if (q.active === 'false') items = items.filter((i) => !i.isActive);
    if (q.q) { const n = normalizeForSearch(q.q); items = items.filter((i) => normalizeForSearch(i.name).includes(n)); }
    if (q.lastPlayedFrom) { const t = Date.parse(q.lastPlayedFrom); items = items.filter((i) => (i.lastPlayedAt ?? 0) >= t); }
    if (q.lastPlayedTo) { const t = Date.parse(q.lastPlayedTo) + 86400_000; items = items.filter((i) => (i.lastPlayedAt ?? 0) < t); }
    const dir = q.order === 'desc' ? -1 : 1;
    const sort = q.sort ?? 'name';
    items.sort((a, b) => {
      const av = sort === 'matches' ? a.matches : sort === 'wins' ? a.wins : sort === 'lastPlayed' ? (a.lastPlayedAt ?? 0) : a.name.toLowerCase();
      const bv = sort === 'matches' ? b.matches : sort === 'wins' ? b.wins : sort === 'lastPlayed' ? (b.lastPlayedAt ?? 0) : b.name.toLowerCase();
      return (av < bv ? -1 : av > bv ? 1 : a.name.localeCompare(b.name)) * dir;
    });
    return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length };
  });

  app.get('/api/v1/players/:key', { config: { perm: 'players.view' } }, async (req) => {
    const { key } = req.params as { key: string };
    const q = req.query as { page?: string; pageSize?: string };
    const k = parseKey(key);
    let where: string; let arg: unknown; let player: Record<string, unknown>;
    if (k.kind === 'registered') {
      const p = ctx.db.prepare('SELECT id, display_name, full_name, notes, is_active FROM players WHERE id = ?').get(k.id) as { id: number; display_name: string; full_name: string | null; notes: string | null; is_active: number } | undefined;
      if (!p) throw E.notFound('Player not found');
      where = 'mp.player_id = ?'; arg = p.id;
      player = { key, kind: 'registered', playerId: p.id, name: p.display_name, fullName: p.full_name, notes: p.notes, isActive: !!p.is_active };
    } else {
      const exists = ctx.db.prepare('SELECT MIN(display_name) n FROM match_players WHERE player_id IS NULL AND display_name = ? COLLATE NOCASE').get(k.name) as { n: string | null };
      if (!exists.n) throw E.notFound('Player not found');
      where = 'mp.player_id IS NULL AND mp.display_name = ? COLLATE NOCASE'; arg = k.name;
      player = { key, kind: 'typed', playerId: null, name: exists.n, isActive: true };
    }
    const rows = ctx.db.prepare(`SELECT m.id, m.match_code, m.play_date, m.started_at, m.status, m.winner_team, m.play_type, mp.team, mp.slot, c.name court
      FROM match_players mp JOIN matches m ON m.id = mp.match_id JOIN courts c ON c.id = m.court_id WHERE ${where} AND m.status <> 'setup' ORDER BY m.id DESC`).all(arg) as HistRow[];
    const seen = new Set<number>(); const uniq = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    const stats = { matches: 0, wins: 0, losses: 0, winPct: 0, gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0, lastPlayedAt: null as number | null };
    const names = ctx.db.prepare('SELECT team, slot, display_name FROM match_players WHERE match_id = ? ORDER BY team, slot');
    const gms = ctx.db.prepare('SELECT score_a a, score_b b, winner_team w, status FROM match_games WHERE match_id = ? ORDER BY game_number');
    const items = uniq.map((r) => {
      const games = gms.all(r.id) as { a: number; b: number; w: 'A' | 'B' | null; status: string }[];
      const people = names.all(r.id) as { team: 'A' | 'B'; slot: number; display_name: string | null }[];
      const lab = (t: 'A' | 'B', s: number) => people.find((p) => p.team === t && p.slot === s)?.display_name ?? `Player ${t === 'A' ? s : (r.play_type === 'singles' ? 2 : s)}`;
      const mine = r.team, opp = r.team === 'A' ? 'B' : 'A';
      const partner = r.play_type === 'doubles' ? lab(mine, r.slot === 1 ? 2 : 1) : null;
      const opponents = people.filter((p) => p.team === opp).map((p) => lab(opp, p.slot));
      let result: 'won' | 'lost' | 'ended_early' | 'cancelled' | 'in_progress' = 'in_progress';
      if (r.status === 'completed') result = r.winner_team === mine ? 'won' : 'lost';
      else if (r.status === 'terminated') result = 'ended_early'; else if (r.status === 'cancelled') result = 'cancelled';
      if (r.status === 'completed') {
        stats.matches++; if (result === 'won') stats.wins++; else stats.losses++;
        for (const g of games) {
          const my = mine === 'A' ? g.a : g.b, their = mine === 'A' ? g.b : g.a;
          stats.pointsFor += my; stats.pointsAgainst += their;
          if (g.w === mine) stats.gamesWon++; else if (g.w) stats.gamesLost++;
        }
      }
      if (r.started_at && (stats.lastPlayedAt == null || r.started_at > stats.lastPlayedAt) && r.status !== 'cancelled') stats.lastPlayedAt = r.started_at;
      return { matchId: r.id, code: r.match_code, playedAt: r.started_at, playDate: r.play_date, courtName: r.court, partner, opponents, games: games.map((g) => `${g.a}–${g.b}`), result };
    });
    stats.winPct = stats.matches ? Math.round((stats.wins / stats.matches) * 100) : 0;
    const page = Math.max(1, Number(q.page ?? 1)); const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 25)));
    return {
      player, stats, matches: { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length },
      note: k.kind === 'typed' ? 'Grouped by the name as typed — different people with the same name appear together.' : undefined,
    };
  });

  app.post('/api/v1/players', { config: { perm: 'players.manage' } }, async (req, reply) => {
    const body = createPlayerSchema.parse(req.body);
    const norm = normalizeForSearch(body.displayName);
    const possibleDuplicates = ctx.db.prepare('SELECT id, display_name AS displayName FROM players WHERE normalized_name = ? AND is_active = 1').all(norm);
    const now = ctx.now();
    const r = ctx.db.prepare('INSERT INTO players (display_name, normalized_name, full_name, notes, is_active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)')
      .run(body.displayName, norm, body.fullName ?? null, body.notes ?? null, now, now);
    audit(ctx, { actor: actorOf(req), action: 'player.create', entityType: 'player', entityId: Number(r.lastInsertRowid), ip: req.ip });
    ctx.pub.invalidate(['players']);
    reply.code(201);
    return { id: Number(r.lastInsertRowid), displayName: body.displayName, possibleDuplicates };
  });

  app.patch('/api/v1/players/:id', { config: { perm: 'players.manage' } }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = patchPlayerSchema.parse(req.body);
    const p = ctx.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as { display_name: string; full_name: string | null; notes: string | null; is_active: number } | undefined;
    if (!p) throw E.notFound('Player not found');
    const dn = body.displayName ?? p.display_name;
    ctx.db.prepare('UPDATE players SET display_name=?, normalized_name=?, full_name=?, notes=?, is_active=?, updated_at=? WHERE id=?').run(
      dn, normalizeForSearch(dn), body.fullName === undefined ? p.full_name : body.fullName, body.notes === undefined ? p.notes : body.notes,
      body.isActive === undefined ? p.is_active : body.isActive ? 1 : 0, ctx.now(), id);
    audit(ctx, { actor: actorOf(req), action: 'player.update', entityType: 'player', entityId: id, details: body, ip: req.ip });
    ctx.pub.invalidate(['players']);
    return { id, displayName: dn };
  });

  const linkSlots = (playerId: number, rawName: string): { slots: number; matches: number } => {
    const name = normalizeTypedName(rawName);
    if (!name) throw E.validation('A name is required');
    const rows = ctx.db.prepare('SELECT id, match_id FROM match_players WHERE player_id IS NULL AND display_name = ? COLLATE NOCASE').all(name) as { id: number; match_id: number }[];
    let slots = 0; const ms = new Set<number>();
    for (const r of rows) {
      if (ctx.db.prepare('SELECT 1 FROM match_players WHERE match_id = ? AND player_id = ?').get(r.match_id, playerId)) continue; // same player twice in a match: leave as typed
      ctx.db.prepare('UPDATE match_players SET player_id = ? WHERE id = ?').run(playerId, r.id); // display_name snapshot unchanged
      slots++; ms.add(r.match_id);
    }
    return { slots, matches: ms.size };
  };
  const countTyped = (rawName: string) => {
    const name = normalizeTypedName(rawName) ?? '';
    const r = ctx.db.prepare('SELECT count(*) s, count(DISTINCT match_id) m FROM match_players WHERE player_id IS NULL AND display_name = ? COLLATE NOCASE').get(name) as { s: number; m: number };
    return { slots: r.s, matches: r.m };
  };

  app.post('/api/v1/players/typed/add-to-directory', { config: { perm: 'players.manage' } }, async (req) => {
    const body = addTypedToDirectorySchema.parse(req.body);
    if (body.dryRun) return { matchesToLink: countTyped(body.name).matches };
    const display = (body.displayName ?? normalizeTypedName(body.name)) as string;
    const now = ctx.now();
    const out = ctx.tx(() => {
      const r = ctx.db.prepare('INSERT INTO players (display_name, normalized_name, is_active, created_at, updated_at) VALUES (?,?,1,?,?)').run(display, normalizeForSearch(display), now, now);
      const id = Number(r.lastInsertRowid);
      return { id, ...linkSlots(id, body.name) };
    });
    audit(ctx, { actor: actorOf(req), action: 'player.add_to_directory', entityType: 'player', entityId: out.id, details: { name: body.name, linkedMatches: out.matches }, ip: req.ip });
    ctx.pub.invalidate(['players', 'matches']);
    return { playerId: out.id, key: `r:${out.id}`, linkedMatches: out.matches, linkedSlots: out.slots };
  });

  app.post('/api/v1/players/:id/link-typed', { config: { perm: 'players.manage' } }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = linkTypedSchema.parse(req.body);
    if (!ctx.db.prepare('SELECT 1 FROM players WHERE id = ?').get(id)) throw E.notFound('Player not found');
    const out = ctx.tx(() => linkSlots(id, body.name));
    audit(ctx, { actor: actorOf(req), action: 'player.link_typed', entityType: 'player', entityId: id, details: { name: body.name, ...out }, ip: req.ip });
    ctx.pub.invalidate(['players', 'matches']);
    return { linkedMatches: out.matches, linkedSlots: out.slots };
  });
}
