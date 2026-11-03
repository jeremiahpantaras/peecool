import { useRef, useState } from 'react';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { Button, Input, Notice, cx } from '../../ui';

export interface PlayerDraft { firstName: string; lastName: string; team: string }
export const emptyDraft = (): PlayerDraft => ({ firstName: '', lastName: '', team: '' });
export const draftComplete = (d: PlayerDraft): boolean => !!d.firstName.trim() && !!d.lastName.trim();
/** Drafts as the API expects them; rows left blank are dropped. */
export const draftsToApi = (rows: PlayerDraft[]) => rows.filter((d) => d.firstName.trim() || d.lastName.trim() || d.team.trim())
  .map((d) => ({ firstName: d.firstName.trim(), lastName: d.lastName.trim(), team: d.team.trim() || undefined }));

/* ---- file import (.csv or .xlsx) ---- */

/** Minimal CSV reader: quotes, escaped quotes, BOM, and comma / semicolon / tab separators. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const FIRST = ['firstname', 'first', 'givenname', 'given', 'forename'], LAST = ['lastname', 'last', 'surname', 'familyname', 'family'], TEAM = ['team', 'teamname', 'club', 'group'], FULL = ['name', 'fullname', 'player', 'playername'];

export interface ImportResult { players: PlayerDraft[]; skipped: number; note: string }
/** Turn spreadsheet rows into players. A header row is detected by its column names; otherwise the order is First, Last, Team. */
export function rowsToPlayers(rows: unknown[][]): ImportResult {
  const cells = rows.map((r) => r.map((c) => (c == null ? '' : String(c).trim())));
  const body = cells.filter((r) => r.some(Boolean));
  if (!body.length) return { players: [], skipped: 0, note: 'The file has no rows.' };
  const head = body[0]!.map(norm);
  const find = (names: string[]) => head.findIndex((h) => names.includes(h));
  let iF = find(FIRST), iL = find(LAST), iT = find(TEAM); const iN = find(FULL);
  let data = body;
  const hasHeader = iF >= 0 || iL >= 0 || iN >= 0;
  if (hasHeader) data = body.slice(1); else { iF = 0; iL = 1; iT = 2; }
  const players: PlayerDraft[] = []; let skipped = 0;
  for (const r of data) {
    let first = iF >= 0 ? r[iF] ?? '' : '', last = iL >= 0 ? r[iL] ?? '' : '';
    if (hasHeader && iF < 0 && iN >= 0 && r[iN]) { const parts = r[iN]!.split(/\s+/); last = parts.length > 1 ? parts.pop()! : ''; first = parts.join(' '); }
    const team = iT >= 0 ? r[iT] ?? '' : '';
    if (!first && !last) { skipped++; continue; }
    players.push({ firstName: first.slice(0, 40), lastName: last.slice(0, 40), team: team.slice(0, 40) });
  }
  return { players, skipped, note: hasHeader ? 'Used the column headings in the first row.' : 'No heading row found: read the columns as First name, Last name, Team.' };
}

export async function readPlayerFile(file: File): Promise<ImportResult> {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt' || file.type === 'text/csv') return rowsToPlayers(parseCsv(await file.text()));
  if (ext === 'xlsx') {
    const { readSheet } = await import('read-excel-file/browser');
    return rowsToPlayers((await readSheet(file)) as unknown[][]);
  }
  throw new Error('Choose a .xlsx or .csv file. (Older .xls files: save as .xlsx first.)');
}

function downloadTemplate() {
  const csv = 'First Name,Last Name,Team\r\nAlex,Rivera,Red\r\nSam,Lee,\r\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'players-template.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Editable player list: one row per player (first name, last name, optional team) plus Import. */
export function PlayerEntry({ rows, onChange, minRows = 0 }: { rows: PlayerDraft[]; onChange: (r: PlayerDraft[]) => void; minRows?: number }) {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ tone: 'info' | 'warn' | 'danger'; text: string } | null>(null);
  const set = (i: number, k: keyof PlayerDraft, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const keys = rows.map((r) => `${r.firstName.trim().toLowerCase()} ${r.lastName.trim().toLowerCase()}`);
  const dup = (i: number) => draftComplete(rows[i]!) && keys.indexOf(keys[i]!) !== i;
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await readPlayerFile(f);
      if (!r.players.length) { setMsg({ tone: 'warn', text: r.note }); return; }
      const blank = (d: PlayerDraft) => !d.firstName && !d.lastName && !d.team;
      onChange([...rows.filter((d) => !blank(d)), ...r.players]);
      const incomplete = r.players.filter((p) => !draftComplete(p)).length;
      setMsg({ tone: incomplete || r.skipped ? 'warn' : 'info', text: `Imported ${r.players.length} player${r.players.length === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped} empty row${r.skipped === 1 ? '' : 's'}` : ''}. ${incomplete ? `${incomplete} still need a first or last name — fix them below. ` : ''}${r.note}` });
    } catch (e) { setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Could not read that file' }); }
    if (file.current) file.current.value = '';
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<Upload className="size-4" />} onClick={() => file.current?.click()}>Import .xlsx or .csv</Button>
        <input ref={file} type="file" aria-label="Import players file" className="hidden" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void onFile(e.target.files?.[0])} />
        <Button variant="ghost" icon={<Download className="size-4" />} onClick={downloadTemplate}>Download template</Button>
        <span className="text-sm text-muted">Columns: First Name, Last Name, Team (optional)</span>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="space-y-2">
        {rows.length > 0 && <div className="hidden grid-cols-[1fr_1fr_1fr_2.5rem] gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted sm:grid"><span>First name</span><span>Last name</span><span>Team (optional)</span><span /></div>}
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_2.5rem]">
            <Input aria-label={`First name ${i + 1}`} placeholder="First name" maxLength={40} value={r.firstName} onChange={(e) => set(i, 'firstName', e.target.value)} className={cx(!r.firstName && r.lastName && 'border-danger')} />
            <Input aria-label={`Last name ${i + 1}`} placeholder="Last name" maxLength={40} value={r.lastName} onChange={(e) => set(i, 'lastName', e.target.value)} className={cx(!r.lastName && r.firstName && 'border-danger')} />
            <Input aria-label={`Team ${i + 1}`} placeholder="Team" maxLength={40} value={r.team} onChange={(e) => set(i, 'team', e.target.value)} className="col-span-1" />
            <button type="button" aria-label={`Remove player ${i + 1}`} disabled={rows.length <= minRows} onClick={() => onChange(rows.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-md text-muted hover:bg-surface2 disabled:opacity-30"><Trash2 className="size-4" /></button>
            {dup(i) && <p className="col-span-full text-xs text-warn">Same name as an earlier row — fine if they are different people.</p>}
          </div>))}
      </div>
      <Button icon={<Plus className="size-4" />} onClick={() => onChange([...rows, emptyDraft()])}>Add player</Button>
    </div>
  );
}
