import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Config {
  dataDir: string;
  dbFile: string;
  port: number;
  host: string;
  webRoot: string | null;
  /** Fast scrypt for tests only */
  fastHash: boolean;
  logLevel: string;
}

export function defaultDataDir(): string {
  if (process.env.PICKLE_DATA_DIR) return process.env.PICKLE_DATA_DIR;
  if (process.platform === 'win32') return path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'PickleScoring');
  return path.resolve(process.cwd(), '.data');
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = overrides.dataDir ?? defaultDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  let file: Record<string, unknown> = {};
  try { file = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')); } catch { /* optional */ }
  const cfg: Config = {
    dataDir,
    dbFile: overrides.dbFile ?? path.join(dataDir, 'pickle.db'),
    port: Number(overrides.port ?? process.env.PICKLE_PORT ?? file.port ?? 8080),
    host: String(overrides.host ?? process.env.PICKLE_HOST ?? file.host ?? '0.0.0.0'),
    webRoot: overrides.webRoot !== undefined ? overrides.webRoot : resolveWebRoot(),
    fastHash: overrides.fastHash ?? false,
    logLevel: overrides.logLevel ?? process.env.PICKLE_LOG_LEVEL ?? 'info',
  };
  return cfg;
}

function resolveWebRoot(): string | null {
  const candidates = [
    process.env.PICKLE_WEB_ROOT,
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), 'public'),
    path.resolve(path.dirname(process.argv[1] ?? ''), 'public'),
  ].filter(Boolean) as string[];
  return candidates.find((c) => fs.existsSync(path.join(c, 'index.html'))) ?? null;
}

/** Lower is better: the facility's own network (192.168.x, 10.x, 172.16-31.x) before anything else. */
function lanRank(ip: string): number {
  if (/^192\.168\./.test(ip)) return 0;
  if (/^10\./.test(ip)) return 1;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return 2;
  return 3;
}

/**
 * IPv4 addresses a phone on the same Wi-Fi could use, best first, for the "Connect a phone or tablet" panel and print-urls.
 * Link-local (169.254.x, no DHCP) addresses never work for a phone, so they are left out.
 */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  return [...new Set(out)].sort((x, y) => lanRank(x) - lanRank(y));
}
