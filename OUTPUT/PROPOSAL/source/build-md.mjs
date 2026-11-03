// Writes the Markdown source of the proposal from content.mjs (same wording as the PDF).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as C from './content.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(dir, 'out', 'Elpisoft_Pickleball_System_Proposal.md');
const L = [];
const ul = (items) => items.forEach((i) => L.push(`- ${i}`));
const tbl = (head, rows) => { L.push(`| ${head.join(' | ')} |`, `|${head.map(() => ' --- ').join('|')}|`); rows.forEach((r) => L.push(`| ${r.join(' | ')} |`)); };
const br = () => L.push('');

L.push(`# ${C.meta.docTitle}`, '', `**${C.meta.kicker}** · Prepared by ${C.meta.preparedBy} · Prepared for ${C.meta.client} · Date: ${C.meta.date}`, '', `${C.meta.contact.web} · ${C.meta.contact.email} · ${C.meta.contact.phone}`, '');

const E = C.executive;
L.push('## 1. Executive summary', ''); E.intro.forEach((p) => L.push(p, ''));
L.push(`### ${E.need.title}`, '', E.need.text, '', `### ${E.solution.title}`, '', E.solution.text, '', `### ${E.valueTitle}`, '');
E.value.forEach(([t, d]) => L.push(`- **${t}.** ${d}`)); br(); L.push(`> ${E.note}`, '');

const O = C.overview;
L.push('## 2. Project overview', ''); O.description.forEach((p) => L.push(p, ''));
L.push('### Main system components', ''); O.components.forEach((c) => L.push(`- **${c.letter}. ${c.name}.** ${c.text}`)); br();
L.push(`### ${O.objectivesTitle}`, ''); O.objectives.forEach((o, i) => L.push(`${i + 1}. ${o}`)); br();

const groups = (gs) => gs.forEach((g) => {
  L.push(`### ${g.n} ${g.title}`, '');
  if (g.roles) g.roles.forEach((r) => { L.push(`**${r.name}**`, ''); ul(r.items); br(); }); else { ul(g.items); br(); }
  if (g.note) L.push(`*${g.note}*`, '');
});
L.push(`## 3. ${C.masterFeatures.title}`, '', C.masterFeatures.lead, ''); groups(C.masterFeatures.groups);
L.push(`### ${C.masterFeatures.backup.title}`, ''); ul(C.masterFeatures.backup.items); br();
L.push(`## 4. ${C.courtFeatures.title}`, '', C.courtFeatures.lead, ''); groups(C.courtFeatures.groups);

const F = C.offline;
L.push(`## 5. ${F.title}`, '', F.lead, '', `> ${F.plain}`, '', '### How it works', ''); F.steps.forEach((s, i) => L.push(`${i + 1}. ${s}`)); br();
L.push('### Internet and local network are not the same thing', ''); F.compare.forEach((c) => L.push(`- **${c.name}.** ${c.text}`)); br();
L.push(`**What the facility still needs.** ${F.needs}`, '', '### Technical deployment details', ''); tbl(['Item', 'Detail'], F.tech); br();
L.push('Architecture: Master PC (Windows 11, SQLite, fixed local IP, UPS) → Ethernet → router and Wi-Fi access points → staff-only Wi-Fi → court devices (Court 1 … Court 24). Internet is optional and not needed for scoring.', '');

L.push('## 6. Packages and pricing', '', 'All prices are in Philippine Pesos (PHP). Every package includes the complete current system.', '');
C.packages.forEach((p) => {
  const k = p.card, D = p.detail;
  L.push(`### ${p.tier}: ${p.name}`, '', `**Price range:** ${p.price}`, '', p.description, '', '**Main inclusions**', ''); ul(k.inclusions); br();
  tbl(['', ''], [['Customization', k.customization], ['Included equipment', k.equipment], ['Revision allowance', k.revisions], ['Maintenance and support', k.support], ['Additional benefits', k.benefits]]); br();
  L.push(`**${D.inclusionsTitle}**`, ''); if (D.inclusions.length) { ul(D.inclusions); br(); }
  D.blocks.forEach((b) => { L.push(`#### ${b.title}`, ''); ul(b.items); br(); });
  if (D.callout) L.push(`> **${D.callout.title}.** ${D.callout.text}`, '');
});

L.push(`## 7. ${C.comparison.title}`, '', C.comparison.lead, ''); tbl(['Feature', 'Package A', 'Package B', 'Package C'], C.comparison.rows); br();
const H = C.hardware;
L.push(`## 8. ${H.title}`, '', H.lead, ''); H.groups.forEach((g) => { L.push(`### ${g.title}`, ''); ul(g.items); br(); });
L.push(`### ${H.matrixTitle}`, ''); tbl(['Equipment', 'Package A', 'Package B', 'Package C'], H.matrix); br(); L.push(H.matrixNote, '');
const I = C.implementation;
L.push(`## 9. ${I.title}`, '', I.lead, ''); I.steps.forEach(([t, d], i) => L.push(`${i + 1}. **${t}.** ${d}`)); br(); L.push(I.datesNote, '');
L.push(`## 10. ${C.glossary.title}`, '', C.glossary.lead, ''); tbl(['Technical term', 'Simple explanation'], C.glossary.rows); br();
L.push(`## 11. ${C.terms.title}`, '', C.terms.lead, ''); C.terms.sections.forEach((s) => { L.push(`### ${s.title}`, ''); ul(s.items); br(); });
const A = C.acceptance;
L.push(`## 12. ${A.title}`, '', A.lead, '', '**Selected package**', ''); C.packages.forEach((p) => L.push(`- [ ] ${p.tier}: ${p.name} (${p.price})`)); br();
L.push(`**${A.client.heading}**`, ''); A.client.fields.forEach((f) => L.push(`- ${f}`)); br();
L.push(`**${A.elpisoft.heading}**`, ''); A.elpisoft.fields.forEach((f) => L.push(`- ${f}`)); br();
L.push('---', '', `${C.meta.contact.web} · ${C.meta.contact.email} · ${C.meta.contact.phone} · ${C.meta.contact.address}`, '', `*${C.meta.tagline}*`, '');
fs.writeFileSync(out, L.join('\n'));
console.log('md', out);
