import { brand, light, dark, cr } from './palette.mjs';
const rows=[]; let fail=0;
const chk=(theme,name,fg,bg,min)=>{const r=cr(fg,bg);const ok=r>=min;if(!ok)fail++;rows.push({theme,name,fg,bg,ratio:+r.toFixed(2),min,ok});};
for (const [t,P] of [['light',light],['dark',dark]]) {
  chk(t,'body text on bg',P.text,P.bg,7); chk(t,'body text on surface',P.text,P.surface,7);
  chk(t,'muted text on bg',P.muted,P.bg,4.5); chk(t,'muted text on surface',P.muted,P.surface,4.5); chk(t,'muted text on surface2',P.muted,P.surface2,4.5);
  chk(t,'primary button label',P.primaryInk,P.primary,4.5);
  chk(t,'accent button label',P.accentInk,P.accent,4.5);
  chk(t,'Team A score on surface',P.teamA,P.surface,7); chk(t,'Team A score on bg',P.teamA,P.bg,7); chk(t,'Team A score on tint',P.teamA,P.teamATint,7);
  chk(t,'Team B score on surface',P.teamB,P.surface,7); chk(t,'Team B score on bg',P.teamB,P.bg,7); chk(t,'Team B score on tint',P.teamB,P.teamBTint,7);
  for (const k of ['success','warn','danger','info']) chk(t,`${k} text on ${k} tint`,P[k],P[k+'Tint'],4.5);
  for (const k of ['success','warn','danger','info']) chk(t,`${k} text on surface`,P[k],P.surface,4.5);
  chk(t,'border vs surface (non-text, 1.2 informal)',P.border,P.surface,1.2);
}
// brand-specific pairs
chk('brand','cream on court-700 (hero)',brand['cream-50'],brand['court-700'],7);
chk('brand','lime-400 on court-700',brand['lime-400'],brand['court-700'],7);
chk('brand','lime-400 on court-900',brand['lime-400'],brand['court-900'],7);
chk('brand','volt-300 on court-700',brand['volt-300'],brand['court-700'],7);
chk('brand','ink on volt-300 (sticker)',brand['ink'],brand['volt-300'],7);
chk('brand','ink on lime-400',brand['ink'],brand['lime-400'],7);
chk('brand','court-700 on cream (headline)',brand['court-700'],brand['cream-50'],7);
chk('brand','white on leaf-500 (row banner)',brand['white'],brand['leaf-500'],4.5);
chk('brand','court-700 on mint-100',brand['court-700'],brand['mint-100'],7);
chk('brand','court-700 on lime-400 (chip)',brand['court-700'],brand['lime-400'],7);
console.table(rows.map(r=>({theme:r.theme,pair:r.name,fg:r.fg,bg:r.bg,ratio:r.ratio,min:r.min,ok:r.ok?'PASS':'FAIL'})));
console.log('failures:',fail);
// reverse sanity: lime on cream must FAIL (documented rule: never text on light)
console.log('lime-400 on cream-50 (documented FAIL):',cr(brand['lime-400'],brand['cream-50']).toFixed(2));
fs_write: { const fs=await import('node:fs'); fs.writeFileSync(new URL('./contrast.json',import.meta.url),JSON.stringify(rows,null,1)); }
