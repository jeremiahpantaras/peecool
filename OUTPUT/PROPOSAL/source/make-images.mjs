// Exports the architecture diagram and the cover sun from proposal.html as PNGs for the DOCX.
import { chromium } from 'playwright'; import path from 'path'; import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 3 });
await p.goto('file://' + path.join(dir, 'proposal.html')); await p.waitForFunction(() => window.READY === true);
await p.locator('svg.arch').screenshot({ path: path.join(dir, 'img/arch.png'), omitBackground: true });
await p.locator('.cv-sunwrap').screenshot({ path: path.join(dir, 'img/sun.png'), omitBackground: true });
const sz = await p.evaluate(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.width, b.height]; }; return { arch: r('svg.arch'), sun: r('.cv-sunwrap') }; });
console.log(JSON.stringify(sz)); await b.close();
