// Assembles ./packaging/stage for Inno Setup:  node packaging/stage.mjs   (run `npm run build` first).
// Downloads the Windows node.exe and WinSW; the native better-sqlite3 binary for win32-x64 comes from its prebuilt release.
// NOT YET VERIFIED ON WINDOWS — see docs/planning/IMPLEMENTATION_ROADMAP.md Phase 13.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, 'packaging', 'stage');
const dist = path.join(root, 'apps', 'server', 'dist');
if (!fs.existsSync(path.join(dist, 'main.js'))) { console.error('Run `npm run build` first.'); process.exit(1); }
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'runtime'), { recursive: true });
fs.cpSync(dist, path.join(stage, 'app'), { recursive: true });

const nodeVer = process.env.NODE_WIN_VERSION ?? process.version; // must match the Node major the code was tested on
const winsw = process.env.WINSW_URL ?? 'https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe';
async function fetchTo(url, file) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
await fetchTo(`https://nodejs.org/dist/${nodeVer}/win-x64/node.exe`, path.join(stage, 'runtime', 'node.exe'));
await fetchTo(winsw, path.join(stage, 'PickleScoringService.exe'));

// better-sqlite3 prebuilt for Windows x64 (installed into stage/app/node_modules)
const bs = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'better-sqlite3', 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(stage, 'app', 'package.json'), JSON.stringify({ name: 'pickle-scoring-runtime', private: true, type: 'module', dependencies: { 'better-sqlite3': bs } }));
execSync('npm install --omit=dev --no-audit --no-fund', { cwd: path.join(stage, 'app'), stdio: 'inherit', env: { ...process.env, npm_config_platform: 'win32', npm_config_arch: 'x64' } });
fs.writeFileSync(path.join(stage, 'pickle-scoring.cmd'), '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0app\\cli.js" %*\r\n');
console.log('Staged at', stage, '→ compile packaging/installer.iss with Inno Setup on Windows.');
