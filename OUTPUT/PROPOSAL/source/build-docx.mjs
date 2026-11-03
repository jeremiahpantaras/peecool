// Builds the editable Word version from content.mjs. Office fallback fonts per the brand guide (p19):
// Arial for Plus Jakarta Sans, Consolas for JetBrains Mono.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, AlignmentType,
  HeadingLevel, ImageRun, Header, Footer, PageNumber, LevelFormat, TabStopType, VerticalAlign, HeightRule, TableLayoutType,
} from 'docx';
import * as C from './content.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(dir, 'out', 'Elpisoft_Pickleball_System_Proposal.docx');
const img = (f) => fs.readFileSync(path.join(dir, f));

const NAVY = '0E1B3D', AMBER = 'FFB020', CORAL = 'FF6B4A', BLUE = '2F5DE6', SLATE = '5A6377', MIST = 'E4E1D9', CLOUD = 'F7F5F0', WHITE = 'FFFFFF';
const SANS = 'Arial', MONO = 'Consolas';
const W = 9866; // content width in DXA (A4 11906 − 2 × 1020)
const HALF = (W - 300) / 2;

// ---------- text helpers ----------
const runs = (text, o = {}) => String(text).split(/(\[[^\]]+\])/).filter(Boolean).map((part) => {
  const ph = /^\[.*\]$/.test(part);
  return new TextRun({ text: part, font: o.font || SANS, size: o.size || 19, bold: o.bold || ph, italics: o.italics, color: ph ? (o.onDark ? WHITE : BLUE) : (o.color || NAVY), characterSpacing: o.spacing, allCaps: o.caps });
});
const P = (text, o = {}) => new Paragraph({ children: runs(text, o), spacing: { before: o.before ?? 0, after: o.after ?? 120, line: o.line ?? 300 }, alignment: o.align, keepNext: o.keepNext });
const kicker = (t, o = {}) => new Paragraph({ children: runs(t, { font: MONO, size: 15, color: o.color || BLUE, caps: true, spacing: 30 }), spacing: { after: 60 }, keepNext: true, pageBreakBefore: o.pageBreak !== false });
const h1 = (t, o = {}) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t })], spacing: { after: 140 } });
const h2 = (t, before = 240) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t })], spacing: { before, after: 100 }, keepNext: true });
const h3 = (t, o = {}) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: t, color: o.color })], spacing: { before: o.before ?? 120, after: 80 }, keepNext: true });
const lead = (t) => P(t, { size: 21, color: SLATE, after: 200, line: 320 });
const bullets = (items, o = {}) => items.map((t) => new Paragraph({ numbering: { reference: 'dots', level: 0 }, children: runs(t, { size: o.size || 18, color: o.color }), spacing: { after: 50, line: 276 } }));
const checks = (items, o = {}) => items.map((t) => new Paragraph({ children: [new TextRun({ text: '✓  ', font: SANS, bold: true, size: o.size || 18, color: o.check || BLUE }), ...runs(t, { size: o.size || 18, color: o.color })], spacing: { after: 50, line: 276 } }));

// ---------- table helpers ----------
const NONE = { style: BorderStyle.NONE, size: 0, color: WHITE };
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const line = (color = MIST, size = 6) => ({ style: BorderStyle.SINGLE, size, color });
const cell = (children, o = {}) => new TableCell({
  children: Array.isArray(children) ? children : [children],
  width: { size: o.w, type: WidthType.DXA },
  shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
  borders: o.borders || { top: NONE, bottom: NONE, left: NONE, right: NONE },
  margins: o.margins || { top: 80, bottom: 80, left: 120, right: 120 },
  verticalAlign: o.valign || VerticalAlign.TOP,
  columnSpan: o.span,
});
const table = (widths, rows, o = {}) => new Table({
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  columnWidths: widths, layout: TableLayoutType.FIXED, borders: o.borders || noBorders,
  rows: rows.map((r, i) => new TableRow({ children: r, tableHeader: o.header && i === 0, cantSplit: true, height: o.height ? { value: o.height, rule: HeightRule.EXACT } : undefined })),
});
const spacer = (after = 120) => new Paragraph({ children: [], spacing: { after } });
const panel = (children, fill = CLOUD, o = {}) => table([o.w || W], [[cell(children, { w: o.w || W, fill, margins: { top: 200, bottom: 160, left: 260, right: 260 }, borders: o.borders })]]);
const note = (title, text) => table([W], [[cell([new Paragraph({ children: [...(title ? [new TextRun({ text: title + ' ', bold: true, font: SANS, size: 18, color: NAVY })] : []), ...runs(text, { size: 18 })], spacing: { line: 276 } })], { w: W, fill: CLOUD, margins: { top: 160, bottom: 160, left: 240, right: 240 }, borders: { top: NONE, bottom: NONE, right: NONE, left: line(AMBER, 36) } })]]);
const twoCols = (left, right, gap = 300) => { const c = (W - gap) / 2; return table([c, gap, c], [[cell(left, { w: c, margins: { top: 0, bottom: 0, left: 0, right: 0 } }), cell([], { w: gap }), cell(right, { w: c, margins: { top: 0, bottom: 0, left: 0, right: 0 } })]]); };
const ruleTop = (children) => [new Paragraph({ children: [], border: { top: line(NAVY, 12) }, spacing: { before: 120, after: 0 } }), ...children];

// ---------- cover ----------
const coverCell = [
  spacer(600),
  new Paragraph({ indent: { left: 1100 }, children: [new ImageRun({ type: 'png', data: img('a/elpisoft_horizontal_reversed_1000w.png'), transformation: { width: 180, height: 45 } })] }),
  spacer(2600),
  new Paragraph({ indent: { left: 1100 }, children: [new TextRun({ text: C.meta.kicker.toUpperCase(), font: MONO, size: 17, color: AMBER, characterSpacing: 40 })], spacing: { after: 260 } }),
  new Paragraph({ indent: { left: 1100, right: 1300 }, children: [new TextRun({ text: C.meta.docTitle, font: SANS, bold: true, size: 72, color: WHITE })], spacing: { after: 300, line: 760, lineRule: 'exact' } }),
  new Paragraph({ indent: { left: 1100, right: 2600 }, children: runs('A complete, locally deployed facility management and scoring solution for up to 24 courts. Built to run on your own network, with or without the internet.', { size: 23, color: 'C9CEDA' }), spacing: { after: 700, line: 340 } }),
  ...[['PREPARED BY', 'Elpisoft'], ['PREPARED FOR', C.meta.client], ['DATE', C.meta.date]].flatMap(([k, v]) => [
    new Paragraph({ indent: { left: 1100 }, children: [new TextRun({ text: k, font: MONO, size: 14, color: '9AA3B8', characterSpacing: 30 })], spacing: { after: 20 } }),
    new Paragraph({ indent: { left: 1100 }, children: runs(v, { size: 21, bold: true, color: WHITE, onDark: true }), spacing: { after: 160 } }),
  ]),
  new Paragraph({ indent: { left: 1100 }, children: [new TextRun({ text: `${C.meta.contact.web} · ${C.meta.contact.email} · ${C.meta.contact.phone}`, font: MONO, size: 14, color: '9AA3B8' })], spacing: { before: 200, after: 500 } }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: img('img/sun.png'), transformation: { width: 529, height: 264 } })], spacing: { after: 0 } }),
];
const cover = table([11906], [[cell(coverCell, { w: 11906, fill: NAVY, margins: { top: 0, bottom: 0, left: 0, right: 0 } })]], { height: 16820 });

// ---------- body ----------
const body = [];
const E = C.executive, O = C.overview, M = C.masterFeatures, K = C.courtFeatures, F = C.offline;

body.push(kicker('01 — Executive summary'), h1(E.title), ...E.intro.map((t) => P(t)), spacer(80));
body.push(twoCols([h3(E.need.title, { before: 0 }), P(E.need.text, { size: 18 })], [h3(E.solution.title, { before: 0 }), P(E.solution.text, { size: 18 })]));
body.push(h2(E.valueTitle));
const vrows = []; for (let i = 0; i < E.value.length; i += 2) vrows.push(E.value.slice(i, i + 2));
body.push(table([W / 2, W / 2], vrows.map((pair) => pair.map(([t, d]) => cell([new Paragraph({ children: [new TextRun({ text: '✓  ', bold: true, font: SANS, size: 19, color: BLUE }), new TextRun({ text: t, bold: true, font: SANS, size: 19, color: NAVY })], spacing: { after: 30 } }), P(d, { size: 17, color: SLATE, after: 60 })], { w: W / 2, margins: { top: 60, bottom: 60, left: 0, right: 200 } })))));
body.push(spacer(120), note('', E.note));

body.push(kicker('02 — Project overview'), h1(O.title), ...O.description.map((t) => P(t)));
body.push(h2('Main system components'));
body.push(twoCols(...O.components.map((c) => [panel([h3(`${c.letter} · ${c.name}`, { before: 0 }), P(c.text, { size: 18, after: 0 })], CLOUD, { w: HALF })])));
body.push(h2(O.objectivesTitle));
O.objectives.forEach((t, i) => body.push(new Paragraph({ children: [new TextRun({ text: String(i + 1).padStart(2, '0') + '   ', font: MONO, size: 16, color: BLUE }), ...runs(t, { size: 19 })], spacing: { after: 80 } })));

// master features
const group = (g) => {
  const parts = [P(g.n, { font: MONO, size: 14, color: BLUE, after: 0 }), h3(g.title, { before: 20 })];
  if (g.roles) g.roles.forEach((r) => parts.push(P(r.name, { bold: true, size: 18, after: 40, before: 60 }), ...bullets(r.items)));
  else parts.push(...bullets(g.items));
  if (g.note) parts.push(P(g.note, { size: 17, italics: true, color: SLATE, before: 60 }));
  return ruleTop(parts);
};
body.push(kicker('03 — System features'), h1(M.title), lead(M.lead));
body.push(twoCols(group(M.groups[0]), group(M.groups[1])), spacer(160));
const ug = M.groups[2];
body.push(...ruleTop([P(ug.n, { font: MONO, size: 14, color: BLUE, after: 0 }), h3(ug.title, { before: 20 })]));
body.push(twoCols(...ug.roles.map((r) => [panel([P(r.name, { bold: true, size: 19, after: 60 }), ...bullets(r.items)], CLOUD, { w: HALF })])));
body.push(P(ug.note, { size: 17, italics: true, color: SLATE, before: 100 }));
body.push(kicker('03 — System features (continued)'), h1('Master System, continued'));
body.push(twoCols(group(M.groups[3]), group(M.groups[4])), spacer(160));
body.push(twoCols(group(M.groups[5]), group(M.groups[6])), spacer(160));
body.push(panel([h3(M.backup.title, { before: 0 }), ...bullets(M.backup.items)]));

body.push(kicker('04 — System features'), h1(K.title), lead(K.lead));
for (let i = 0; i < K.groups.length; i += 2) body.push(twoCols(group(K.groups[i]), group(K.groups[i + 1])), spacer(120));

body.push(kicker('05 — Offline operation'), h1('Works without the internet'), lead(F.lead));
body.push(panel([P(F.plain, { size: 21, color: WHITE, after: 0, line: 330 })], NAVY));
body.push(h2('How it works'));
F.steps.forEach((t, i) => body.push(new Paragraph({ children: [new TextRun({ text: `${i + 1}   `, font: MONO, bold: true, size: 18, color: BLUE }), ...runs(t, { size: 19 })], spacing: { after: 80 } })));
body.push(h2('Internet and local network are not the same thing'));
body.push(twoCols(...F.compare.map((c) => [panel([h3(c.name, { before: 0 }), P(c.text, { size: 18, after: 0 })], CLOUD, { w: HALF })])));
body.push(spacer(160), note('What the facility still needs.', F.needs));

body.push(kicker('05 — System architecture'), h1('How the pieces connect'), lead('Everything inside the dashed line is the facility’s own local network. Scoring, management and reports all happen there.'));
body.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: img('img/arch.png'), transformation: { width: 640, height: 330 } })], spacing: { after: 200 } }));
body.push(h2('Technical deployment details'));
body.push(table([3200, W - 3200], F.tech.map(([k, v], i) => [cell(P(k, { bold: true, size: 18, after: 0 }), { w: 3200, borders: { top: i ? NONE : line(NAVY, 12), bottom: line(), left: NONE, right: NONE } }), cell(P(v, { size: 18, after: 0 }), { w: W - 3200, borders: { top: i ? NONE : line(NAVY, 12), bottom: line(), left: NONE, right: NONE } })])));

// packages
const card = (p, cw) => {
  const dark = p.id === 'B', fg = dark ? WHITE : NAVY, sub = dark ? 'C9CEDA' : SLATE, lab = dark ? AMBER : BLUE;
  const fact = (label, v) => [P(label, { font: MONO, size: 13, caps: true, spacing: 20, color: dark ? '9AA3B8' : SLATE, after: 10, before: 100 }), P(v, { size: 18, bold: true, color: fg, after: 0 })];
  const k = p.card;
  const children = [
    P(p.tier, { font: MONO, size: 14, caps: true, spacing: 20, color: lab, after: 40 }),
    P(p.name, { size: 32, bold: true, color: fg, after: 160 }),
    new Paragraph({ children: [new TextRun({ text: 'PHP  ', font: SANS, bold: true, size: 18, color: sub }), new TextRun({ text: p.priceShort, font: SANS, bold: true, size: 44, color: fg })], spacing: { after: 20 } }),
    P('Project price range', { size: 15, color: sub, after: 140 }),
    P(p.description, { size: 17, color: sub, after: 160 }),
    P('Main inclusions', { font: MONO, size: 13, caps: true, spacing: 20, color: dark ? '9AA3B8' : SLATE, after: 60 }),
    ...checks(k.inclusions, { color: fg, check: dark ? AMBER : BLUE, size: 17 }),
    ...fact('Customization', k.customization), ...fact('Included equipment', k.equipment), ...fact('Revision allowance', k.revisions),
    ...fact('Maintenance and support', k.support), ...fact('Additional benefits', k.benefits),
  ];
  const bc = p.id === 'C' ? AMBER : p.id === 'B' ? NAVY : MIST;
  return table([cw], [[cell(children, { w: cw, fill: dark ? NAVY : WHITE, margins: { top: 280, bottom: 260, left: 300, right: 300 }, borders: { top: line(p.id === 'C' ? CORAL : bc, p.id === 'C' ? 36 : 8), bottom: line(bc, 8), left: line(bc, 8), right: line(bc, 8) } })]]);
};
C.packages.forEach((p) => {
  const D = p.detail, cw = 4700, rw = W - cw - 300;
  const right = [];
  if (D.inclusions.length === 0) right.push(P('✓  ' + D.inclusionsTitle, { bold: true, size: 19, after: 120 }));
  D.blocks.forEach((b) => right.push(...ruleTop([h3(b.title, { before: 40 }), ...bullets(b.items)])));
  if (p.id === 'A' && D.callout) right.push(spacer(80), P(D.callout.title + '.', { bold: true, size: 18, after: 40 }), P(D.callout.text, { size: 17, color: SLATE }));
  body.push(kicker(`06 — Packages and pricing · ${p.tier}`), h1(`${p.tier}: ${p.name}`));
  body.push(table([cw, 300, rw], [[cell(card(p, cw), { w: cw, margins: { top: 0, bottom: 0, left: 0, right: 0 } }), cell([], { w: 300 }), cell(right, { w: rw, margins: { top: 0, bottom: 0, left: 0, right: 0 } })]]));
  if (D.inclusions.length) {
    const third = Math.ceil(D.inclusions.length / 3), cols = [0, 1, 2].map((i) => D.inclusions.slice(i * third, (i + 1) * third)), cw3 = W / 3;
    body.push(spacer(160), table([W], [[cell([h3(D.inclusionsTitle, { before: 0 }), table([cw3 - 100, cw3 - 100, cw3 - 100], [cols.map((c) => cell(bullets(c, { size: 17 }), { w: cw3 - 100, margins: { top: 0, bottom: 0, left: 0, right: 120 } }))])], { w: W, fill: CLOUD, margins: { top: 200, bottom: 120, left: 200, right: 200 } })]]));
  }
  if (p.id !== 'A' && D.callout) body.push(spacer(160), note(D.callout.title + '.', D.callout.text));
});

// comparison
const yes = (v, dark) => v === 'Included' ? [new TextRun({ text: '✓ ', bold: true, font: SANS, size: 17, color: BLUE }), new TextRun({ text: 'Included', font: SANS, bold: true, size: 17, color: NAVY })]
  : v === 'Not included' ? [new TextRun({ text: '– Not included', font: SANS, size: 17, color: SLATE })] : [new TextRun({ text: v, font: SANS, bold: true, size: 17, color: NAVY })];
const cmpTable = (headLabel, rows, withNames) => {
  const w0 = 3400, wc = (W - w0) / 3;
  const head = [cell(P(headLabel, { bold: true, size: 17, after: 0 }), { w: w0, borders: { bottom: line(NAVY, 12), top: NONE, left: NONE, right: NONE } }),
    ...C.packages.map((p) => cell([P(p.tier, { bold: true, size: 17, after: 0, color: p.id === 'B' ? WHITE : NAVY }), ...(withNames ? [P(p.name, { size: 14, color: p.id === 'B' ? 'C9CEDA' : SLATE, after: 0 })] : [])], { w: wc, fill: p.id === 'B' ? NAVY : undefined, valign: VerticalAlign.BOTTOM, borders: { bottom: line(NAVY, 12), top: p.id === 'C' ? line(AMBER, 24) : NONE, left: NONE, right: NONE } }))];
  return table([w0, wc, wc, wc], [head, ...rows.map((r, i) => [cell(P(r[0], { bold: true, size: 17, after: 0 }), { w: w0, fill: i % 2 ? 'FBFAF7' : undefined, borders: { bottom: line(), top: NONE, left: NONE, right: NONE } }),
    ...r.slice(1).map((v) => cell(new Paragraph({ children: yes(v) }), { w: wc, fill: i % 2 ? 'FBFAF7' : undefined, borders: { bottom: line(), top: NONE, left: NONE, right: NONE } }))])], { header: true });
};
body.push(kicker('07 — Package comparison'), h1(C.comparison.title), lead(C.comparison.lead));
const mw = (W - 400) / 3;
body.push(table([mw, 200, mw, 200, mw], [[...C.packages.flatMap((p, i) => {
  const dark = p.id === 'B', fg = dark ? WHITE : NAVY, sub = dark ? 'C9CEDA' : SLATE, bc = p.id === 'C' ? AMBER : p.id === 'B' ? NAVY : MIST;
  const c = cell([P(p.tier, { font: MONO, size: 13, caps: true, spacing: 20, color: dark ? AMBER : BLUE, after: 30 }), P(p.name, { size: 21, bold: true, color: fg, after: 80 }), new Paragraph({ children: [new TextRun({ text: 'PHP ', font: SANS, bold: true, size: 14, color: sub }), new TextRun({ text: p.priceShort, font: SANS, bold: true, size: 24, color: fg })], spacing: { after: 20 } }), P('Project price range', { size: 13, color: sub, after: 0 })],
    { w: mw, fill: dark ? NAVY : WHITE, margins: { top: 200, bottom: 200, left: 200, right: 160 }, borders: { top: line(p.id === 'C' ? CORAL : bc, p.id === 'C' ? 30 : 8), bottom: line(bc, 8), left: line(bc, 8), right: line(bc, 8) } });
  return i < 2 ? [c, cell([], { w: 200 })] : [c];
})]]));
body.push(spacer(240), cmpTable('Feature', C.comparison.rows, true));

// hardware
const H = C.hardware;
body.push(kicker('08 — Hardware and network'), h1(H.title), lead(H.lead));
H.groups.forEach((g) => body.push(...ruleTop([h3(g.title, { before: 40 }), ...bullets(g.items)])));
body.push(h2(H.matrixTitle), cmpTable('Equipment', H.matrix, false), spacer(160), note('', H.matrixNote));

// implementation
const I = C.implementation;
body.push(kicker('09 — Implementation and deployment'), h1(I.title), lead(I.lead));
body.push(table([900, W - 900], I.steps.map(([t, d], i) => [
  cell(P(String(i + 1).padStart(2, '0'), { font: MONO, bold: true, size: 18, color: i === 0 ? WHITE : NAVY, align: AlignmentType.CENTER, after: 0 }), { w: 900, fill: i === 0 ? NAVY : i === 8 ? AMBER : CLOUD, valign: VerticalAlign.CENTER, borders: { top: NONE, left: NONE, right: NONE, bottom: line(WHITE, 24) } }),
  cell([P(t, { bold: true, size: 19, after: 30 }), P(d, { size: 17, color: SLATE, after: 0 })], { w: W - 900, borders: { top: NONE, left: NONE, right: NONE, bottom: line() }, margins: { top: 100, bottom: 100, left: 220, right: 120 } }),
])));
body.push(spacer(160), note('', I.datesNote));

// glossary
const Gl = C.glossary, half = Math.ceil(Gl.rows.length / 2);
const glTable = (rows, start) => table([3100, W - 3100], [
  [cell(P('Technical term', { font: MONO, size: 14, caps: true, spacing: 20, color: SLATE, after: 0 }), { w: 3100, borders: { bottom: line(NAVY, 12), top: NONE, left: NONE, right: NONE } }), cell(P('Simple explanation', { font: MONO, size: 14, caps: true, spacing: 20, color: SLATE, after: 0 }), { w: W - 3100, borders: { bottom: line(NAVY, 12), top: NONE, left: NONE, right: NONE } })],
  ...rows.map(([t, d], i) => [cell(new Paragraph({ children: [new TextRun({ text: String(start + i + 1).padStart(2, '0') + '  ', font: MONO, size: 14, color: BLUE }), new TextRun({ text: t, bold: true, font: SANS, size: 18, color: NAVY })] }), { w: 3100, borders: { bottom: line(), top: NONE, left: NONE, right: NONE } }), cell(P(d, { size: 18, after: 0 }), { w: W - 3100, borders: { bottom: line(), top: NONE, left: NONE, right: NONE } })]),
], { header: true });
body.push(kicker('10 — Definition of terms'), h1(Gl.title), lead(Gl.lead), glTable(Gl.rows.slice(0, half), 0));
body.push(kicker('10 — Definition of terms (continued)'), h1('Definition of terms, continued'), glTable(Gl.rows.slice(half), half));

// terms
const T = C.terms;
body.push(kicker('11 — Terms and conditions'), h1(T.title), lead(T.lead));
T.sections.forEach((s, i) => { if (i === 3) body.push(kicker('11 — Terms and conditions (continued)'), h1('Terms and conditions, continued')); body.push(...ruleTop([h3(s.title, { before: 40 }), ...bullets(s.items)])); });

// acceptance
const A = C.acceptance;
body.push(kicker('12 — Acceptance and approval'), h1(A.title), lead(A.lead));
body.push(panel([P('Selected package', { font: MONO, size: 14, caps: true, spacing: 20, color: SLATE, after: 100 }),
  ...C.packages.map((p) => new Paragraph({ children: [new TextRun({ text: '☐   ', font: SANS, size: 22, color: NAVY }), new TextRun({ text: `${p.tier} — ${p.name}`, font: SANS, bold: true, size: 19, color: NAVY }), new TextRun({ text: `\t${p.price}`, font: SANS, size: 18, color: SLATE })], tabStops: [{ type: TabStopType.RIGHT, position: W - 600 }], spacing: { after: 80 } }))], WHITE, { borders: { top: line(), bottom: line(), left: line(), right: line() } }));
const sigBlock = (b) => [P(b.heading, { font: MONO, size: 15, caps: true, spacing: 20, color: BLUE, after: 200 }), ...b.fields.flatMap((f) => { const [k, ...v] = f.split(':'); const val = v.join(':').trim();
  return [new Paragraph({ children: [new TextRun({ text: k + ':  ', font: SANS, size: 18, color: SLATE }), ...(val ? runs(val, { size: 18, bold: true }) : [])], border: { bottom: line(SLATE, 6) }, spacing: { before: 320, after: 60 } })]; })];
body.push(spacer(300), twoCols(sigBlock(A.client), sigBlock(A.elpisoft), 600));
body.push(spacer(400), panel([new Paragraph({ children: [new ImageRun({ type: 'png', data: img('a/elpisoft_symbol_full-color_512w.png'), transformation: { width: 34, height: 36 } }), new TextRun({ text: '   Thank you for considering Elpisoft.', font: SANS, bold: true, size: 21, color: NAVY })], spacing: { after: 80 } }),
  P(`${C.meta.contact.web} · ${C.meta.contact.email} · ${C.meta.contact.phone} (${C.meta.contact.phoneNote}) · ${C.meta.contact.address}`, { size: 16, color: SLATE, after: 60 }), P(C.meta.tagline, { bold: true, size: 19, after: 0 })]));

// ---------- document ----------
const header = new Header({ children: [new Paragraph({
  children: [new ImageRun({ type: 'png', data: img('a/elpisoft_horizontal_full-color_1000w.png'), transformation: { width: 84, height: 21 } }), new TextRun({ text: '\tPICKLEBALL SYSTEM PROPOSAL', font: MONO, size: 13, color: SLATE, characterSpacing: 20 })],
  tabStops: [{ type: TabStopType.RIGHT, position: W }], border: { bottom: line(MIST, 6) }, spacing: { after: 120 } })] });
const footer = new Footer({ children: [new Paragraph({
  children: [new TextRun({ text: C.meta.footer.toUpperCase(), font: MONO, size: 12, color: SLATE, characterSpacing: 10 }), new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: MONO, size: 12, color: SLATE })],
  tabStops: [{ type: TabStopType.RIGHT, position: W }], border: { top: line(MIST, 6) }, spacing: { before: 120 } })] });

const doc = new Document({
  creator: 'Elpisoft', title: 'Elpisoft — Pickleball Court Management and Scoring System Proposal', description: 'Business proposal',
  styles: {
    default: { document: { run: { font: SANS, size: 19, color: NAVY } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: SANS, size: 44, bold: true, color: NAVY }, paragraph: { spacing: { after: 140 }, outlineLevel: 0, keepNext: true } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: SANS, size: 27, bold: true, color: NAVY }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1, keepNext: true } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: SANS, size: 21, bold: true, color: NAVY }, paragraph: { spacing: { before: 120, after: 80 }, outlineLevel: 2, keepNext: true } },
    ],
  },
  numbering: { config: [{ reference: 'dots', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { run: { color: CORAL }, paragraph: { indent: { left: 300, hanging: 220 } } } }] }] },
  sections: [
    { properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } } }, children: [cover] },
    { properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1150, left: 1020, right: 1020, header: 560, footer: 520 } } }, headers: { default: header }, footers: { default: footer }, children: body },
  ],
});
fs.writeFileSync(out, await Packer.toBuffer(doc));
console.log('docx', out);
