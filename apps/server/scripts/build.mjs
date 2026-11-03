// Bundles the service and CLI into dist/ (better-sqlite3 stays external: native module shipped beside the bundle).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../dist');
fs.rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: { main: path.resolve(here, '../src/main.ts'), cli: path.resolve(here, '../src/cli.ts') },
  outdir: out, bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: true,
  external: ['better-sqlite3'], banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
const web = path.resolve(here, '../../web/dist');
if (fs.existsSync(web)) fs.cpSync(web, path.join(out, 'public'), { recursive: true });
console.log('server bundle written to', out);
