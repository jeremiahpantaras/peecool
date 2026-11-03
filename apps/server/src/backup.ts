import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { localDate, zonedParts } from '@pickle/shared';
import type { Ctx } from './context';
import { openDb, latestMigrationId, migrate } from './db/client';
import { AppError, E } from './lib/errors';

export type BackupType = 'scheduled' | 'manual' | 'pre_migration' | 'pre_restore';
export interface BackupInfo { fileName: string; type: BackupType; createdAt: number; sizeBytes: number; schemaVersion: number | null }

const NAME_RE = /^pickle-\d{8}-\d{6}-(scheduled|manual|pre_migration|pre_restore)\.db$/;
export const backupDir = (ctx: Ctx): string => { const d = path.join(ctx.config.dataDir, 'backups'); fs.mkdirSync(d, { recursive: true }); return d; };

function stamp(ms: number, tz: string): string {
  const d = zonedParts(ms, tz); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.year}${p(d.month)}${p(d.day)}-${p(d.hour)}${p(d.minute)}${p(d.second)}`;
}

export function schemaVersionOf(file: string): number | null {
  try { const d = new Database(file, { readonly: true, fileMustExist: true }); try { return d.pragma('user_version', { simple: true }) as number; } finally { d.close(); } } catch { return null; }
}

export function listBackups(ctx: Ctx): BackupInfo[] {
  const dir = backupDir(ctx);
  return fs.readdirSync(dir).filter((f) => NAME_RE.test(f)).map((f) => {
    const st = fs.statSync(path.join(dir, f));
    return { fileName: f, type: NAME_RE.exec(f)![1] as BackupType, createdAt: st.mtimeMs, sizeBytes: st.size, schemaVersion: schemaVersionOf(path.join(dir, f)) };
  }).sort((a, b) => b.createdAt - a.createdAt);
}

export function backupPath(ctx: Ctx, fileName: string): string {
  if (!NAME_RE.test(fileName)) throw E.notFound('Backup not found');
  const p = path.join(backupDir(ctx), fileName);
  if (!fs.existsSync(p)) throw E.notFound('Backup not found');
  return p;
}

export async function createBackup(ctx: Ctx, type: BackupType): Promise<BackupInfo> {
  const dir = backupDir(ctx);
  let name = `pickle-${stamp(ctx.now(), ctx.timeZone)}-${type}.db`;
  let n = 1;
  while (fs.existsSync(path.join(dir, name))) name = `pickle-${stamp(ctx.now() + n++ * 1000, ctx.timeZone)}-${type}.db`;
  const dest = path.join(dir, name);
  await ctx.db.backup(dest); // SQLite online backup API — consistent while running
  try { fs.copyFileSync(path.join(ctx.config.dataDir, 'config.json'), dest.replace(/\.db$/, '.config.json')); } catch { /* config is optional */ }
  ctx.backupState.lastAt = ctx.now();
  const extra = ctx.settings().backupExtraPath;
  if (extra && (type === 'scheduled' || type === 'manual')) {
    try { fs.mkdirSync(extra, { recursive: true }); fs.copyFileSync(dest, path.join(extra, name)); ctx.backupState.extraError = null; }
    catch (e) { ctx.backupState.extraError = (e as Error).message; ctx.log.warn({ err: e }, 'backup copy to extra path failed'); }
  }
  pruneBackups(ctx);
  const st = fs.statSync(dest);
  return { fileName: name, type, createdAt: st.mtimeMs, sizeBytes: st.size, schemaVersion: schemaVersionOf(dest) };
}

function pruneBackups(ctx: Ctx): void {
  const keep = ctx.settings().backupRetention;
  const sched = listBackups(ctx).filter((b) => b.type === 'scheduled');
  for (const b of sched.slice(keep)) deleteBackupFiles(ctx, b.fileName);
}

export function deleteBackupFiles(ctx: Ctx, fileName: string): void {
  const p = backupPath(ctx, fileName);
  fs.rmSync(p, { force: true });
  fs.rmSync(p.replace(/\.db$/, '.config.json'), { force: true });
}

export async function testExtraPath(dir: string): Promise<{ ok: boolean; error?: string }> {
  try { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, `.write-test-${Date.now()}`); fs.writeFileSync(f, 'ok'); fs.rmSync(f); return { ok: true }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** FR-BACKUP-06: validate integrity + schema, swap the file, reopen, tell clients. */
export async function restoreFrom(ctx: Ctx, sourceFile: string, force: boolean): Promise<void> {
  const ver = schemaVersionOf(sourceFile);
  if (ver == null) throw E.validation('That file is not a valid database');
  if (ver > latestMigrationId()) throw E.validation('That backup was made by a newer version of the software');
  const probe = new Database(sourceFile, { readonly: true });
  try {
    const ic = probe.pragma('integrity_check', { simple: true });
    if (ic !== 'ok') throw E.validation('The backup file failed its integrity check');
    const hasUsers = probe.prepare("SELECT 1 FROM sqlite_master WHERE name = 'users'").get();
    if (!hasUsers) throw E.validation('That file does not look like a Pickle Scoring database');
  } finally { probe.close(); }

  if (!ctx.recovery?.corrupt) {
    const active = (ctx.db.prepare("SELECT count(*) c FROM matches WHERE status IN ('setup','in_progress','paused')").get() as { c: number }).c;
    if (active && !force) throw E.conflict('ACTIVE_MATCHES_EXIST', `${active} match(es) are in progress. Restoring will replace them.`, { active });
    try { await createBackup(ctx, 'pre_restore'); } catch (e) { ctx.log.warn({ err: e }, 'pre-restore backup failed'); }
  }
  ctx.maintenanceGate = true;
  ctx.pub.broadcast('server:shutdown', { reason: 'restore' });
  try {
    try { ctx.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* corrupt db */ }
    try { ctx.db.close(); } catch { /* ignore */ }
    const file = ctx.config.dbFile;
    if (fs.existsSync(file) && ctx.recovery?.corrupt) fs.renameSync(file, path.join(path.dirname(file), `pickle.corrupt-${stamp(ctx.now(), ctx.timeZone)}.db`));
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
    fs.copyFileSync(sourceFile, file);
    ctx.db = openDb(file);
    migrate(ctx.db);
    ctx.invalidateSettings();
    ctx.dbGeneration++;
    ctx.recovery = null;
  } finally { ctx.maintenanceGate = false; }
  ctx.pub.broadcast('system:restored', {});
}

export function todayHasScheduledBackup(ctx: Ctx): boolean {
  const today = localDate(ctx.now(), ctx.timeZone).replace(/-/g, '');
  return listBackups(ctx).some((b) => b.type === 'scheduled' && b.fileName.startsWith(`pickle-${today}`));
}

export { AppError };
