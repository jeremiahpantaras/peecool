import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, Monitor, Play, Plus, Square } from 'lucide-react';
import type { OpenPlayGameDto, OpenPlaySessionDto } from '@pickle/shared';
import { Badge, Button, Card, CardHeader, ConfirmDialog, Empty, ErrorBox, Field, Notice, PageHeader, Select, Spinner, Table, Td, Th, ViewOnlyTag, cx, fmtClock, useNow } from '../ui';
import { del, get, patch, post } from '../lib/api';
import { useIsAdmin } from '../lib/auth';
import { realtime } from '../lib/realtime';
import { toast, toastError } from '../lib/toast';
import { fmtTime } from '../lib/time';
import { GameCard, PlayerStatusBadge, ResultDialog, STATUS_BADGE, StandingsCard, SwapDialog, WaitingChips, teamNames } from './openplay/parts';
import { SessionForm, type FormValue } from './OpenPlay';
import { PlayerEntry, draftComplete, draftsToApi, emptyDraft, type PlayerDraft } from './openplay/PlayerEntry';

export function useSession(id: number) {
  useEffect(() => realtime.want('all'), []);
  return useQuery({ queryKey: ['openplay', id], queryFn: () => get<OpenPlaySessionDto>(`open-play/${id}`), refetchInterval: 20_000 });
}

export default function OpenPlaySession() {
  const id = Number(useParams().id);
  const admin = useIsAdmin();
  const qc = useQueryClient();
  const q = useSession(id);
  const d = q.data;
  const [dialog, setDialog] = useState<{ kind: 'result' | 'swap'; g: OpenPlayGameDto } | null>(null);
  const [confirm, setConfirm] = useState<'end' | 'cancel' | null>(null);
  const [drafts, setDrafts] = useState<PlayerDraft[]>([emptyDraft()]);
  const run = useMutation({
    mutationFn: ({ method, path, body }: { method: 'post' | 'patch' | 'del'; path: string; body?: unknown }) => (method === 'post' ? post(`open-play/${id}${path}`, body) : method === 'patch' ? patch(`open-play/${id}${path}`, body) : del(`open-play/${id}${path}`)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['openplay'] }); setDialog(null); setConfirm(null); }, onError: toastError,
  });
  const act = (path: string, body?: unknown, method: 'post' | 'patch' | 'del' = 'post') => run.mutate({ method, path, body });
  const now = useNow(1000);

  if (q.isLoading) return <Spinner />;
  if (q.error || !d) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const live = d.status === 'running' || d.status === 'ending';
  const left = d.endsAt ? d.endsAt - now : null;
  const round = d.currentRound;
  const notStarted = round?.games.filter((g) => g.status === 'scheduled').length ?? 0;
  const addPlayers = () => {
    const list = draftsToApi(drafts);
    if (!list.length) return;
    run.mutate({ method: 'post', path: '/players', body: { players: list } }, { onSuccess: () => setDrafts([emptyDraft()]) });
  };

  return (
    <div className="space-y-4">
      <Link to="/open-play" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="size-4" />All sessions</Link>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3">{d.name}<Badge tone={STATUS_BADGE[d.status].tone}>{STATUS_BADGE[d.status].label}</Badge></span>}
        sub={`${d.playType === 'doubles' ? 'Doubles' : 'Singles'} · ${d.courts.map((c) => c.name).join(', ')} · ${d.gameMinutes}-minute games · ${d.rulesSummary}`}
        actions={<div className="flex flex-wrap gap-2">
          <Link to={`/open-play/${id}/board`} target="_blank"><Button icon={<Monitor className="size-4" />}>TV board</Button></Link>
          {admin ? null : <ViewOnlyTag />}
        </div>} />

      {d.status === 'setup' && <SetupPanel d={d} admin={admin} busy={run.isPending} drafts={drafts} setDrafts={setDrafts} addPlayers={addPlayers} act={act} onCancel={() => setConfirm('cancel')} />}

      {live && round && (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <div><p className="text-xs uppercase tracking-wide text-muted">Round</p><p className="tnum text-2xl font-bold">{round.number}</p></div>
              <div><p className="text-xs uppercase tracking-wide text-muted">Session time left</p><p className={cx('tnum inline-flex items-center gap-2 text-2xl font-bold', left != null && left < 0 && 'text-warn')}><Clock className="size-5" />{left != null ? (left > 0 ? fmtClock(left) : 'over') : '–'}</p></div>
              <div><p className="text-xs uppercase tracking-wide text-muted">Ends at</p><p className="tnum text-lg font-semibold">{d.endsAt ? fmtTime(d.endsAt) : '–'}</p></div>
              {d.status === 'ending' && <Notice tone="warn" className="flex-1">Ending: the games in progress finish, and no new round will start.</Notice>}
              {admin && (
                <div className="ml-auto flex flex-wrap gap-2">
                  {notStarted > 1 && <Button icon={<Play className="size-4" />} loading={run.isPending} onClick={() => act('/start-all')}>Start all waiting courts</Button>}
                  <Button variant="danger" icon={<Square className="size-4" />} onClick={() => setConfirm('end')}>End session</Button>
                </div>)}
            </div>
            {d.warnings.map((w) => <Notice key={w} tone="warn" className="mt-3">{w}</Notice>)}
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {round.games.map((g) => (
              <GameCard key={g.id} g={g} actions={admin && (g.status === 'scheduled' || g.status === 'playing') ? (<>
                {g.status === 'scheduled' && <Button size="sm" onClick={() => setDialog({ kind: 'swap', g })}>Swap player</Button>}
                {g.status === 'scheduled' && <Button size="sm" onClick={() => act(`/games/${g.id}/cancel`)}>Cancel game</Button>}
                {!g.timeUp && <Button size="sm" onClick={() => act(`/games/${g.id}/extend`, { minutes: 5 })}>+5 min</Button>}
                <Button size="sm" onClick={() => setDialog({ kind: 'result', g })}>Enter result…</Button>
              </>) : undefined} />))}
          </div>

          <Card>
            <CardHeader title="Waiting for the next round" sub={d.waitingForPlayers ? 'Not enough active players for a full game — add players to continue.' : 'Whoever has played the fewest games and waited longest goes on next.'} />
            <div className="p-4"><WaitingChips names={round.waiting.map((p) => p.name)} /></div>
          </Card>
        </>
      )}

      {live && !round && <Card><Empty title="Waiting for players">{d.waitingForPlayers ? 'Add players to continue the session.' : 'The next round will be published shortly.'}</Empty></Card>}
      {d.status === 'finished' && <Notice>This session has finished. The final standings are below{d.champions.length ? '' : '.'}</Notice>}

      {d.status !== 'setup' && <div className={cx('grid gap-4', d.status !== 'finished' && 'xl:grid-cols-2')}><StandingsCard d={d} />{d.status !== 'finished' && <PlayersCard d={d} admin={admin} act={act} />}</div>}
      {d.status !== 'setup' && d.rounds.length > 0 && <RoundsCard d={d} />}

      {dialog?.kind === 'result' && <ResultDialog g={dialog.g} busy={run.isPending} onClose={() => setDialog(null)} onSave={(b) => act(`/games/${dialog.g.id}/result`, b)} />}
      {dialog?.kind === 'swap' && round && <SwapDialog d={d} g={dialog.g} busy={run.isPending} onClose={() => setDialog(null)} onSwap={(a, b) => act('/swap', { playerA: a, playerB: b })} />}
      <ConfirmDialog open={confirm === 'end'} title="End this session?" danger confirmLabel="End session" loading={run.isPending} onClose={() => setConfirm(null)} onConfirm={() => act('/end', {})}>
        No new round will start. Games in progress can finish on their courts; then the final standings are fixed.
        <div className="mt-3"><Button variant="danger" loading={run.isPending} onClick={() => { act('/end', { force: true }); toast('Ending all games now', 'info'); }}>End everything now (games in progress count no winner)</Button></div>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'cancel'} title="Cancel this session?" danger confirmLabel="Cancel session" loading={run.isPending} onClose={() => setConfirm(null)} onConfirm={() => act('/end', {})}>It has not started, so nothing is lost.</ConfirmDialog>
    </div>
  );
}

function SetupPanel({ d, admin, busy, drafts, setDrafts, addPlayers, act, onCancel }: { d: OpenPlaySessionDto; admin: boolean; busy: boolean; drafts: PlayerDraft[]; setDrafts: (r: PlayerDraft[]) => void; addPlayers: () => void; act: (p: string, b?: unknown, m?: 'post' | 'patch' | 'del') => void; onCancel: () => void }) {
  const [v, setV] = useState<FormValue>({ name: d.name, playType: d.playType, courtIds: d.courts.map((c) => c.id), sessionMinutes: d.sessionMinutes, gameMinutes: d.gameMinutes, changeoverMinutes: d.changeoverMinutes });
  const dirty = v.name !== d.name || v.playType !== d.playType || v.sessionMinutes !== d.sessionMinutes || v.gameMinutes !== d.gameMinutes || v.changeoverMinutes !== d.changeoverMinutes || v.courtIds.join() !== d.courts.map((c) => c.id).join();
  const active = d.players.filter((p) => p.status === 'active').length;
  const need = d.playType === 'singles' ? 2 : 4;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title={`Players (${d.players.length})`} sub="Add everyone taking part. The first round is a random draw when you press Start." />
        <div className="space-y-3 p-4">
          {admin && <>
            <PlayerEntry rows={drafts} onChange={setDrafts} />
            <Button variant="primary" icon={<Plus className="size-4" />} loading={busy} disabled={!draftsToApi(drafts).length || drafts.some((d) => (d.firstName || d.lastName || d.team) && !draftComplete(d))} onClick={addPlayers}>Add to session</Button>
          </>}
          <ul className="divide-y divide-line rounded-md border border-line">{d.players.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2"><span className="flex-1">{p.name}</span>{p.team && <Badge>{p.team}</Badge>}{admin && <Button size="sm" variant="ghost" onClick={() => act(`/players/${p.id}`, undefined, 'del')}>Remove</Button>}</li>))}
            {!d.players.length && <li className="px-3 py-4 text-sm text-muted">No players yet.</li>}</ul>
        </div>
      </Card>
      <Card>
        <CardHeader title="Settings" />
        <div className="space-y-4 p-4">
          {admin ? <SessionForm value={v} onChange={setV} playerCount={d.players.length} /> : <p className="text-sm text-muted">Only the Admin can change settings.</p>}
          {admin && <div className="flex flex-wrap gap-2">
            <Button disabled={!dirty} loading={busy} onClick={() => act('', v, 'patch')}>Save settings</Button>
            <Button variant="primary" icon={<Play className="size-4" />} loading={busy} disabled={dirty || active < need} onClick={() => act('/start')}>Start session</Button>
            <Button variant="ghost" onClick={onCancel}>Cancel session</Button>
          </div>}
          {admin && dirty && <p className="text-sm text-muted">Save your settings before starting.</p>}
          {admin && active < need && <p className="text-sm text-muted">At least {need} players are needed for {d.playType}.</p>}
        </div>
      </Card>
    </div>
  );
}

function PlayersCard({ d, admin, act }: { d: OpenPlaySessionDto; admin: boolean; act: (p: string, b?: unknown, m?: 'post' | 'patch' | 'del') => void }) {
  const [late, setLate] = useState<PlayerDraft[]>([emptyDraft()]);
  return (
    <Card>
      <CardHeader title={`Players (${d.players.filter((p) => p.status !== 'left').length} active)`} sub="Resting or left players are skipped from the next round; their results stay." />
      <Table>
        <thead><tr><Th>Player</Th><Th>Team</Th><Th>Now</Th><Th>Games incl. current</Th>{admin && <Th>Status</Th>}</tr></thead>
        <tbody>{d.players.map((p) => (
          <tr key={p.id}><Td className="font-medium">{p.name}</Td><Td>{p.team ?? ''}</Td><Td><PlayerStatusBadge p={p} /></Td><Td className="tnum">{p.played}</Td>
            {admin && (d.status === 'running' || d.status === 'ending') && <Td><Select aria-label={`Status of ${p.name}`} value={p.status} onChange={(e) => act(`/players/${p.id}`, { status: e.target.value }, 'patch')}><option value="active">Active</option><option value="resting">Resting</option><option value="left">Left</option></Select></Td>}
            {admin && d.status === 'finished' && <Td />}</tr>))}</tbody>
      </Table>
      {admin && d.status === 'running' && (
        <div className="space-y-2 border-t border-line p-3">
          <p className="text-sm font-medium">Add a late player</p>
          <PlayerEntry rows={late} onChange={setLate} minRows={1} />
          <Button variant="primary" disabled={!draftComplete(late[0]!)} onClick={() => { act('/players', { players: draftsToApi(late) }); setLate([emptyDraft()]); }}>Add to session</Button>
        </div>)}
    </Card>
  );
}

function RoundsCard({ d }: { d: OpenPlaySessionDto }) {
  return (
    <Card>
      <CardHeader title="Rounds" sub="Every game played in this session" />
      <div className="divide-y divide-line">{[...d.rounds].reverse().map((r) => (
        <details key={r.id} className="group px-4 py-3" open={r.id === d.currentRound?.id}>
          <summary className="cursor-pointer font-semibold">Round {r.number} <span className="ml-2 text-sm font-normal text-muted">{r.status === 'active' ? 'in progress' : 'closed'}</span></summary>
          <ul className="mt-2 space-y-1 text-sm">{r.games.map((g) => (
            <li key={g.id} className="flex flex-wrap items-baseline gap-x-3"><span className="w-20 shrink-0 text-muted">{g.courtName}</span>
              <span className={cx(g.winner === 'A' && 'font-bold')}>{teamNames(g.teamA)}</span><span className="tnum font-semibold">{g.status === 'finished' ? `${g.scoreA} – ${g.scoreB}` : g.status === 'cancelled' ? 'cancelled' : 'vs'}</span><span className={cx(g.winner === 'B' && 'font-bold')}>{teamNames(g.teamB)}</span></li>))}
            {r.waiting.length > 0 && <li className="text-muted">Waiting: {r.waiting.map((p) => p.name).join(', ')}</li>}</ul>
        </details>))}</div>
    </Card>
  );
}
