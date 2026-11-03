// Prints proposal.html to a US Legal (8.5 × 14 in) PDF and reports any page whose content overflows its box.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(dir, 'out', 'Elpisoft_Pickleball_System_Proposal.pdf');
const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const p = await b.newPage();
await p.goto('file://' + path.join(dir, 'proposal.html'));
await p.waitForFunction(() => window.READY === true);
await p.emulateMedia({ media: 'print' });
const problems = await p.evaluate(() => {
  const res = [];
  document.querySelectorAll('.page').forEach((pg, i) => {
    const c = pg.querySelector('.content'); if (!c) return;
    if (c.scrollHeight > c.clientHeight + 1) res.push(`page ${i + 1}: content overflows by ${c.scrollHeight - c.clientHeight}px`);
    const cb = c.getBoundingClientRect();
    c.querySelectorAll('.pprice').forEach((el) => { const card = el.closest('.pcard').getBoundingClientRect(); if (el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > card.right - 8) res.push(`page ${i + 1}: price too wide for its card`); });
    c.querySelectorAll('*').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width && (r.right > cb.right + 1)) res.push(`page ${i + 1}: ${el.tagName}.${el.className} overflows right by ${Math.round(r.right - cb.right)}px`); });
  });
  return [...new Set(res)].slice(0, 30);
});
console.log(problems.length ? problems.join('\n') : 'no overflow');
await p.pdf({ path: out, width: '8.5in', height: '14in', printBackground: true, preferCSSPageSize: true });
await b.close();
console.log('pdf', out);
