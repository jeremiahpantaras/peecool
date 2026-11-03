// Builds proposal.html (explicit US Legal pages) from content.mjs. Printed to PDF by build-pdf.mjs.
import fs from 'fs';
import * as C from './content.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// light inline emphasis for placeholders: [LIKE THIS]
const fmt = (s) => esc(s).replace(/\[([^\]]+)\]/g, '<span class="ph">[$1]</span>');

const ICON = {
  check: '<svg class="i" viewBox="0 0 16 16"><path d="M3.5 8.4 6.6 11.4 12.6 4.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  dash: '<svg class="i" viewBox="0 0 16 16"><path d="M4.5 8h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};
const list = (items, cls = 'dots') => `<ul class="${cls}">${items.map((i) => `<li>${fmt(i)}</li>`).join('')}</ul>`;
const checks = (items) => `<ul class="checks">${items.map((i) => `<li>${ICON.check}<span>${fmt(i)}</span></li>`).join('')}</ul>`;

const SUN = (id) => `<svg viewBox="0 0 200 100" preserveAspectRatio="none" class="sun"><defs><linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FF6B4A"/><stop offset="1" stop-color="#FFB020"/></linearGradient></defs><path d="M0 100 A100 100 0 0 1 200 100 Z" fill="url(#${id})"/></svg>`;

const pages = [];
const page = (label, body, cls = '') => pages.push({ label, body, cls });
const head = (kicker, title, lead) => `<div class="kicker">${esc(kicker)}</div><h1>${esc(title)}</h1>${lead ? `<p class="lead">${fmt(lead)}</p>` : ''}`;

// ---------- 1. Cover ----------
pages.push({ cover: true, body: `
  <div class="cv-grid"></div>
  <img class="cv-logo" src="a/elpisoft_horizontal_reversed.svg" alt="Elpisoft">
  <div class="cv-main">
    <div class="cv-kicker">${esc(C.meta.kicker)}</div>
    <div class="cv-title">Pickleball Court Management and Scoring System</div>
    <p class="cv-sub">A complete, locally deployed facility management and scoring solution for up to 24 courts. Built to run on your own network, with or without the internet.</p>
  </div>
  <div class="cv-meta">
    <div><span>Prepared by</span><b>Elpisoft</b></div>
    <div><span>Prepared for</span><b>${fmt(C.meta.client)}</b></div>
    <div><span>Date</span><b>${fmt(C.meta.date)}</b></div>
  </div>
  <div class="cv-sunwrap">${SUN('cvs')}</div>
  <div class="cv-foot">${esc(C.meta.contact.web)} · ${esc(C.meta.contact.email)} · ${esc(C.meta.contact.phone)}</div>
` });

// ---------- 2. Executive summary ----------
{
  const E = C.executive;
  page('Executive summary', `${head('01 — Executive summary', E.title)}
    ${E.intro.map((p) => `<p class="body">${fmt(p)}</p>`).join('')}
    <div class="two gap8 mt6">
      <div class="panel"><h3>${esc(E.need.title)}</h3><p class="body">${fmt(E.need.text)}</p></div>
      <div class="panel navy"><h3>${esc(E.solution.title)}</h3><p class="body">${fmt(E.solution.text)}</p></div>
    </div>
    <h2 class="mt8">${esc(E.valueTitle)}</h2>
    <div class="vgrid">${E.value.map(([t, d]) => `<div class="v"><div class="vt">${ICON.check}${esc(t)}</div><div class="vd">${fmt(d)}</div></div>`).join('')}</div>
    <div class="note mt6">${fmt(E.note)}</div>`);
}

// ---------- 3. Project overview ----------
{
  const O = C.overview;
  page('Project overview', `${head('02 — Project overview', O.title)}
    ${O.description.map((p) => `<p class="body">${fmt(p)}</p>`).join('')}
    <h2 class="mt8">Main system components</h2>
    <div class="two gap6">${O.components.map((c) => `<div class="comp"><div class="cl">${c.letter}</div><h3>${esc(c.name)}</h3><p class="body">${fmt(c.text)}</p></div>`).join('')}</div>
    <h2 class="mt8">${esc(O.objectivesTitle)}</h2>
    <ol class="nums">${O.objectives.map((o) => `<li>${fmt(o)}</li>`).join('')}</ol>
    <div class="facts mt8">
      <div><b>Up to 24</b><span>courts, configured by the administrator</span></div>
      <div><b>2 roles</b><span>Admin (Owner) and Staff</span></div>
      <div><b>Offline</b><span>no internet needed for daily scoring</span></div>
    </div>`);
}

// ---------- 4. Master features (two pages) ----------
const groupHTML = (g) => {
  let inner = '';
  if (g.roles) inner = `<div class="roles">${g.roles.map((r) => `<div class="role"><div class="rn">${esc(r.name)}</div>${list(r.items)}</div>`).join('')}</div>`;
  else inner = list(g.items);
  return `<div class="fg"><div class="fgn">${g.n}</div><h3>${esc(g.title)}</h3>${inner}${g.note ? `<p class="fnote">${fmt(g.note)}</p>` : ''}</div>`;
};
{
  const M = C.masterFeatures, G = M.groups;
  page('Master System', `${head('03 — System features', M.title, M.lead)}
    <div class="two gap6 mt4">${groupHTML(G[0])}${groupHTML(G[1])}</div>
    <div class="mt5">${groupHTML(G[2])}</div>`);
  page('Master System', `<div class="kicker">03 — System features (continued)</div><h1>Master System, continued</h1>
    <div class="two gap6 mt4">${groupHTML(G[3])}${groupHTML(G[4])}</div>
    <div class="two gap6 mt5">${groupHTML(G[5])}${groupHTML(G[6])}</div>
    <div class="panel mt5"><h3>${esc(M.backup.title)}</h3>${list(M.backup.items)}</div>`);
}

// ---------- 5. Court scoring features ----------
{
  const K = C.courtFeatures, G = K.groups;
  page('Court Scoring System', `${head('04 — System features', K.title, K.lead)}
    <div class="three gap5 mt4">${G.map(groupHTML).join('')}</div>`, 'court');
}

// ---------- 6. Offline operation + architecture ----------
{
  const F = C.offline;
  page('Offline operation', `${head('05 — Offline operation', 'Works without the internet', F.lead)}
    <div class="plain"><div class="pq">“</div><p>${fmt(F.plain)}</p></div>
    <h2 class="mt7">How it works</h2>
    <ol class="steps2">${F.steps.map((s, i) => `<li><span class="sn">${i + 1}</span><span>${fmt(s)}</span></li>`).join('')}</ol>
    <h2 class="mt7">Internet and local network are not the same thing</h2>
    <div class="two gap6">${F.compare.map((c, i) => `<div class="panel ${i ? 'blue' : ''}"><h3>${esc(c.name)}</h3><p class="body">${fmt(c.text)}</p></div>`).join('')}</div>
    <div class="note warn mt6"><b>What the facility still needs.</b> ${fmt(F.needs)}</div>`);
  page('System architecture', `<div class="kicker">05 — System architecture</div><h1>How the pieces connect</h1>
    <p class="lead">Everything inside the dashed line is the facility’s own local network. Scoring, management and reports all happen there.</p>
    ${archSVG()}
    <h2 class="mt7">Technical deployment details</h2>
    <table class="kv">${F.tech.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${fmt(v)}</td></tr>`).join('')}</table>`);
}

function archSVG() {
  const courts = Array.from({ length: 6 }, (_, i) => i);
  const dev = (x, y, label) => `<g transform="translate(${x} ${y})"><rect width="62" height="44" rx="7" fill="#fff" stroke="#0E1B3D" stroke-width="1.6"/><rect x="6" y="6" width="50" height="26" rx="3" fill="#F7F5F0"/><text x="31" y="23" text-anchor="middle" class="t-dev">${label.split(' ')[1]}</text><text x="31" y="40" text-anchor="middle" class="t-sm">${label}</text></g>`;
  return `<svg class="arch" viewBox="0 0 640 330">
    <defs><linearGradient id="ag" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FF6B4A"/><stop offset="1" stop-color="#FFB020"/></linearGradient></defs>
    <rect x="4" y="74" width="632" height="252" rx="16" fill="#F7F5F0" stroke="#5A6377" stroke-width="1.3" stroke-dasharray="6 5"/>
    <text x="22" y="98" class="t-lab">FACILITY LOCAL NETWORK (LAN) · NO INTERNET REQUIRED</text>
    <!-- internet, optional -->
    <g transform="translate(250 4)"><rect width="140" height="44" rx="22" fill="#fff" stroke="#E4E1D9" stroke-width="1.5"/>
      <text x="70" y="20" text-anchor="middle" class="t-h" fill="#5A6377">Internet</text><text x="70" y="35" text-anchor="middle" class="t-sm">optional · not needed for scoring</text></g>
    <line x1="320" y1="48" x2="320" y2="128" stroke="#5A6377" stroke-width="1.4" stroke-dasharray="3 4"/>
    <!-- master pc -->
    <g transform="translate(26 132)"><rect width="168" height="128" rx="12" fill="#0E1B3D"/>
      <rect x="16" y="16" width="136" height="56" rx="6" fill="#13234c" stroke="rgba(255,255,255,.18)"/>
      <path d="M58 72 h52 l6 14 h-64 z" fill="#13234c"/>
      <text x="84" y="40" text-anchor="middle" class="t-hw">Master PC</text><text x="84" y="58" text-anchor="middle" class="t-smw">Master System</text>
      <text x="84" y="104" text-anchor="middle" class="t-smw">Windows 11 · SQLite database</text><text x="84" y="118" text-anchor="middle" class="t-smw">Fixed local IP address</text></g>
    <g transform="translate(26 270)"><rect width="168" height="30" rx="8" fill="#fff" stroke="#E4E1D9" stroke-width="1.3"/><text x="84" y="19" text-anchor="middle" class="t-sm">UPS power protection (recommended)</text></g>
    <!-- ethernet -->
    <line x1="194" y1="196" x2="262" y2="196" stroke="#0E1B3D" stroke-width="3"/>
    <text x="228" y="186" text-anchor="middle" class="t-sm">Ethernet</text>
    <!-- router -->
    <g transform="translate(262 150)"><rect width="116" height="92" rx="12" fill="#fff" stroke="#0E1B3D" stroke-width="1.6"/>
      <path d="M40 34 q18 -16 36 0 M46 40 q12 -10 24 0" fill="none" stroke="#2F5DE6" stroke-width="2.2" stroke-linecap="round"/><circle cx="58" cy="46" r="3" fill="#2F5DE6"/>
      <text x="58" y="66" text-anchor="middle" class="t-h">Router and</text><text x="58" y="81" text-anchor="middle" class="t-h">Wi-Fi access points</text></g>
    <!-- wifi -->
    <line x1="378" y1="196" x2="420" y2="196" stroke="#2F5DE6" stroke-width="2.4" stroke-dasharray="5 5"/>
    <text x="399" y="230" text-anchor="middle" class="t-sm">Staff-only</text><text x="399" y="243" text-anchor="middle" class="t-sm">Wi-Fi</text>
    <!-- courts -->
    <g>${courts.map((i) => dev(424 + (i % 3) * 70, 126 + Math.floor(i / 3) * 62, `Court ${i + 1}`)).join('')}</g>
    <text x="529" y="262" text-anchor="middle" class="t-sm">… up to Court 24</text>
    <text x="529" y="278" text-anchor="middle" class="t-sm">Tablets or smartphones (browser)</text>
    <g transform="translate(424 290)"><rect width="200" height="24" rx="12" fill="url(#ag)"/><text x="100" y="16" text-anchor="middle" class="t-h">Live scores, real time</text></g>
  </svg>`;
}

// ---------- 7–9. Packages ----------
const cardHTML = (p, mini = false) => {
  const k = p.card;
  const fact = (label, v) => `<div class="pf"><div class="pfl">${label}</div><div class="pfv">${fmt(v)}</div></div>`;
  return `<div class="pcard p${p.id}${mini ? ' mini' : ''}">
    ${p.id === 'C' ? '<div class="band"></div>' : ''}
    <div class="ptier">${esc(p.tier)}</div>
    <div class="pname">${esc(p.name)}</div>
    <div class="pprice"><span class="cur">PHP</span>${esc(p.priceShort)}</div>
    <div class="pnote">Project price range</div>
    <p class="pdesc">${fmt(p.description)}</p>
    ${mini ? '' : `<div class="psec">Main inclusions</div>${checks(k.inclusions)}
    <div class="pfacts">${fact('Customization', k.customization)}${fact('Included equipment', k.equipment)}${fact('Revision allowance', k.revisions)}${fact('Maintenance and support', k.support)}${fact('Additional benefits', k.benefits)}</div>`}
  </div>`;
};
C.packages.forEach((p, i) => {
  const D = p.detail;
  const blocks = D.blocks.map((b) => `<div class="blk"><h3>${esc(b.title)}</h3>${list(b.items)}</div>`).join('');
  const incl = D.inclusions.length ? `<div class="panel mt5"><h3>${esc(D.inclusionsTitle)}</h3>${list(D.inclusions, 'dots cols3')}</div>` : `<div class="inherit">${ICON.check}<span>${esc(D.inclusionsTitle)}</span></div>`;
  const callout = D.callout ? `<div class="note mt5"><b>${esc(D.callout.title)}.</b> ${fmt(D.callout.text)}</div>` : '';
  const right = p.id === 'A' ? `<div class="blocks">${blocks}</div>${callout}` : `${incl}<div class="blocks">${blocks}</div>`;
  page('Packages and pricing', `<div class="kicker">06 — Packages and pricing · ${esc(p.tier)}</div><h1>${esc(p.tier)}: ${esc(p.name)}</h1>
    <div class="pkg">${cardHTML(p)}<div class="pright">${right}</div></div>
    ${p.id === 'A' ? incl : callout}`, `pkgpage pkg${p.id}`);
});

// ---------- 10. Comparison ----------
{
  const Q = C.comparison;
  const cell = (v) => v === 'Included' ? `<span class="yes">${ICON.check}Included</span>` : v === 'Not included' ? `<span class="no">${ICON.dash}Not included</span>` : `<b>${esc(v)}</b>`;
  page('Package comparison', `${head('07 — Package comparison', Q.title, Q.lead)}
    <div class="three gap4 mt4">${C.packages.map((p) => cardHTML(p, true)).join('')}</div>
    <table class="cmp mt6"><thead><tr><th>Feature</th>${C.packages.map((p) => `<th class="h${p.id}">${esc(p.tier)}<small>${esc(p.name)}</small></th>`).join('')}</tr></thead>
    <tbody>${Q.rows.map((r) => `<tr><td>${esc(r[0])}</td>${r.slice(1).map((v) => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
}

// ---------- 11. Hardware ----------
{
  const H = C.hardware;
  const cell = (v) => v === 'Included' ? `<span class="yes">${ICON.check}Included</span>` : `<span class="no">${ICON.dash}Not included</span>`;
  page('Hardware and network', `${head('08 — Hardware and network', H.title, H.lead)}
    <div class="three gap5 mt4">${H.groups.map((g) => `<div class="fg"><h3>${esc(g.title)}</h3>${list(g.items)}</div>`).join('')}</div>
    <h2 class="mt7">${esc(H.matrixTitle)}</h2>
    <table class="cmp"><thead><tr><th>Equipment</th>${C.packages.map((p) => `<th class="h${p.id}">${esc(p.tier)}</th>`).join('')}</tr></thead>
    <tbody>${H.matrix.map((r) => `<tr><td>${esc(r[0])}</td>${r.slice(1).map((v) => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <div class="note mt5">${fmt(H.matrixNote)}</div>`);
}

// ---------- 12. Implementation ----------
{
  const I = C.implementation;
  page('Implementation', `${head('09 — Implementation and deployment', I.title, I.lead)}
    <ol class="timeline">${I.steps.map(([t, d], i) => `<li><div class="tn">${String(i + 1).padStart(2, '0')}</div><div><h3>${esc(t)}</h3><p>${fmt(d)}</p></div></li>`).join('')}</ol>
    <div class="note mt5">${fmt(I.datesNote)}</div>`);
}

// ---------- 13. Glossary (two pages) ----------
{
  const Gl = C.glossary, half = Math.ceil(Gl.rows.length / 2);
  const tbl = (rows, start) => `<table class="gl"><thead><tr><th>Technical term</th><th>Simple explanation</th></tr></thead><tbody>${rows.map(([t, d], i) => `<tr><td><span class="gn">${String(start + i + 1).padStart(2, '0')}</span>${esc(t)}</td><td>${fmt(d)}</td></tr>`).join('')}</tbody></table>`;
  page('Definition of terms', `${head('10 — Definition of terms', Gl.title, Gl.lead)}${tbl(Gl.rows.slice(0, half), 0)}`);
  page('Definition of terms', `<div class="kicker">10 — Definition of terms (continued)</div><h1>Definition of terms, continued</h1>${tbl(Gl.rows.slice(half), half)}`);
}

// ---------- 14. Terms (two pages) ----------
{
  const T = C.terms, s = T.sections;
  const sec = (x) => `<div class="tsec"><h3>${esc(x.title)}</h3>${list(x.items)}</div>`;
  page('Terms and conditions', `${head('11 — Terms and conditions', T.title, T.lead)}${s.slice(0, 3).map(sec).join('')}`);
  page('Terms and conditions', `<div class="kicker">11 — Terms and conditions (continued)</div><h1>Terms and conditions, continued</h1>${s.slice(3).map(sec).join('')}`);
}

// ---------- 15. Acceptance ----------
{
  const A = C.acceptance;
  const box = (b) => `<div class="sig"><div class="sigh">${esc(b.heading)}</div>${b.fields.map((f) => { const [k, ...v] = f.split(':'); const val = v.join(':').trim(); return `<div class="sf"><span>${esc(k)}</span><b>${val ? fmt(val) : ''}</b></div>`; }).join('')}</div>`;
  page('Acceptance and approval', `${head('12 — Acceptance and approval', A.title, A.lead)}
    <div class="pick"><div class="pfl">Selected package</div>${C.packages.map((p) => `<div class="pk"><span class="box"></span><b>${esc(p.tier)}</b> — ${esc(p.name)}<em>${esc(p.price)}</em></div>`).join('')}</div>
    <div class="two gap8 mt8">${box(A.client)}${box(A.elpisoft)}</div>
    <div class="closing mt8"><img src="a/elpisoft_symbol_full-color.svg" alt=""><div><b>Thank you for considering Elpisoft.</b><span>${esc(C.meta.contact.web)} · ${esc(C.meta.contact.email)} · ${esc(C.meta.contact.phone)} (${esc(C.meta.contact.phoneNote)}) · ${esc(C.meta.contact.address)}</span></div><div class="tg">${esc(C.meta.tagline)}</div></div>`);
}

// ---------- assemble ----------
const total = pages.length;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Elpisoft — Pickleball Court Management and Scoring System Proposal</title>
<link rel="stylesheet" href="proposal.css"></head><body>
${pages.map((p, i) => p.cover ? `<section class="page cover">${p.body}</section>` : `<section class="page ${p.cls}">
  <header><img src="a/elpisoft_horizontal_full-color.svg" alt="Elpisoft"><span>${esc(p.label)}</span></header>
  <div class="content">${p.body}</div>
  <footer><span>${esc(C.meta.footer)}</span><span>${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></footer>
</section>`).join('\n')}
<script>document.fonts.ready.then(() => { window.READY = true; });</script>
</body></html>`;
fs.writeFileSync(new URL('./proposal.html', import.meta.url), html);
console.log('pages', total);
