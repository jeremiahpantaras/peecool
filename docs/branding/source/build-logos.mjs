import fs from 'node:fs'; import { createRequire } from 'node:module';
import { symbol, ballPath } from './geom.mjs';
const require=createRequire(import.meta.url); const opentype=require('opentype.js'); const { decompress }=require('wawoff2');
const woff=new URL('../fonts/barlow-condensed-latin-800-normal.woff2',import.meta.url).pathname; // wordmark is outlined from this font (SIL OFL)
const buf=Buffer.from(await decompress(fs.readFileSync(woff)));
export const font=opentype.parse(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
export const CAP=font.tables.os2.sCapHeight/font.unitsPerEm;
const f=n=>+n.toFixed(2);
export function textPath(text,{size,x=0,baseline=0,tracking=0}){
  const path=new opentype.Path(); let cx=x, prev=null;
  for(const ch of text){ const g=font.charToGlyph(ch); if(prev) cx+=font.getKerningValue(prev,g)*size/font.unitsPerEm;
    path.extend(g.getPath(cx,baseline,size)); cx+=g.advanceWidth*size/font.unitsPerEm+tracking; prev=g; }
  const bb=path.getBoundingBox(); return { d:path.toPathData(2), x1:bb.x1, x2:bb.x2, y1:bb.y1, y2:bb.y2 };
}
export const C={ court700:'#0D3F27', court900:'#082015', court950:'#06150D', lime400:'#C4E94A', volt300:'#F4FB5A', cream50:'#F8FFEF', ink:'#0F1A13' };
// themes: v = bounce+wordmark+line colour; ball fill; ring (or null); dots
export const THEMES={
  primary:{v:C.court700, ball:C.lime400, ring:C.court700, dots:C.court700},
  dark:   {v:C.ink,      ball:C.lime400, ring:C.ink,      dots:C.ink},
  light:  {v:C.cream50,  ball:C.lime400, ring:null,       dots:C.court900},
};
const CAPH=58, TRACK=3.2, GAP=12, SYMW=118;
function wordmark(){ const size=CAPH/CAP; return textPath('PEECOOL',{size,x:0,baseline:0,tracking:TRACK}); }
const header=(vb,title,desc)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-labelledby="t d"><title id="t">${title}</title><desc id="d">${desc}</desc>`;
function symbolGroup(t,s,{line=true,lineW,transform=''}={}){
  const dots=s.holes.map(h=>`<circle cx="${h[0]}" cy="${h[1]}" r="${h[2]}"/>`).join('');
  const ring=t.ring?` stroke="${t.ring}" stroke-width="2.6"`:'';
  return `<g id="symbol"${transform?` transform="${transform}"`:''}><path id="bounce" fill="${t.v}" d="${s.v}"/><circle id="ball" cx="${s.ball.cx}" cy="${s.ball.cy}" r="${s.ball.r}" fill="${t.ball}"${ring}/><g id="perforations" fill="${t.dots}">${dots}</g></g>`;
}
const OPT={T:[8,14],V:[50,92],R:[88,46],wR:24,wV:24,ballR:16,gap:4,yb:98};
export const sym=symbol(OPT);
export function primary(themeName='primary'){
  const t=THEMES[themeName], w=wordmark(), baseline=98, x0=SYMW+GAP;
  const wm=textPath('PEECOOL',{size:CAPH/CAP,x:x0,baseline,tracking:TRACK});
  const end=Math.ceil(wm.x2)+2;
  return header(`0 0 ${end+6} 120`,'Peecool','Peecool logo: a bounce-shaped check mark with a perforated ball, above a court line, beside the wordmark PEECOOL.')
   +symbolGroup(t,sym)+`<path id="wordmark" fill="${t.v}" d="${wm.d}"/><rect id="court-line" x="6" y="104" width="${end-6}" height="6" rx="3" fill="${t.v}"/></svg>`;
}
export function secondary(themeName='primary'){
  const t=THEMES[themeName], size=CAPH*0.5/CAP; const wm=textPath('PEECOOL',{size,x:0,baseline:0,tracking:TRACK*1.4});
  const W=Math.max(wm.x2,118), symOff=(W-118)/2, y=124+Math.round(CAPH*0.5)+4;
  const wm2=textPath('PEECOOL',{size,x:0,baseline:y,tracking:TRACK*1.4});
  return header(`-10 0 ${W+20} ${y+10}`,'Peecool','Peecool stacked logo: bounce symbol above the wordmark PEECOOL.')
   +`<g transform="translate(${f(symOff)} 0)">`+symbolGroup(t,sym)+`<rect id="court-line" x="6" y="104" width="108" height="6" rx="3" fill="${t.v}"/></g><path id="wordmark" fill="${t.v}" d="${wm2.d}"/></svg>`;
}
export function icon(themeName='primary'){ const t=THEMES[themeName];
  return header('0 0 120 120','Peecool symbol','Peecool symbol: a bounce-shaped check mark with a perforated ball, above a court line.')+symbolGroup(t,sym)+`<rect id="court-line" x="6" y="104" width="108" height="6" rx="3" fill="${t.v}"/></svg>`; }
export function monochrome(){
  const w=textPath('PEECOOL',{size:CAPH/CAP,x:SYMW+GAP,baseline:98,tracking:TRACK}); const end=Math.ceil(w.x2)+2;
  const holes=sym.holes.map(h=>[h[0],h[1],h[2]]);
  return header(`0 0 ${end+6} 120`,'Peecool','Peecool single-colour logo. Uses currentColor.')
   +`<g fill="currentColor"><path id="bounce" d="${sym.v}"/><path id="ball" fill-rule="evenodd" d="${ballPath({cx:sym.ball.cx,cy:sym.ball.cy,r:sym.ball.r},holes)}"/><path id="wordmark" d="${w.d}"/><rect id="court-line" x="6" y="104" width="${end-6}" height="6" rx="3"/></g></svg>`;
}
// app icon: court-700 tile, lime bounce, cream ball w/ perforations. size 1024 grid, symbol scaled.
export function appIcon({maskable=false}={}){
  const S=maskable?5.4:6.4, tx=512-63*S, ty=512-60*S; const rx=maskable?0:230;
  const tile=`<rect width="1024" height="1024" rx="${rx}" fill="${C.court700}"/>`;
  const dots=sym.holes.map(h=>`<circle cx="${h[0]}" cy="${h[1]}" r="${h[2]}"/>`).join('');
  const g=`<g transform="translate(${f(tx)} ${f(ty)}) scale(${S})"><path fill="${C.lime400}" d="${sym.v}"/><circle cx="${sym.ball.cx}" cy="${sym.ball.cy}" r="${sym.ball.r}" fill="${C.cream50}"/><g fill="${C.court700}">${dots}</g><rect x="6" y="104" width="108" height="6" rx="3" fill="${C.cream50}"/></g>`;
  return header('0 0 1024 1024','Peecool app icon','Peecool app icon: lime bounce symbol and cream perforated ball on deep court green.')+tile+g+'</svg>';
}
// favicon: simplified for 16px — no perforations, no court line, heavier arms
export function favicon(){
  const s=symbol({T:[10,16],V:[48,90],R:[86,44],wT:8,wV:30,wR:30,ballR:17,gap:3,yb:96,lineY:[0,0]});
  return header('0 0 120 120','Peecool','Peecool favicon.')+`<rect width="120" height="120" rx="27" fill="${C.court700}"/><g transform="translate(14 17) scale(.82)"><path fill="${C.lime400}" d="${s.v}"/><circle cx="${s.ball.cx}" cy="${s.ball.cy}" r="${s.ball.r}" fill="${C.cream50}"/></g></svg>`;
}
export const ALL={ 'logo-primary.svg':()=>primary('primary'), 'logo-secondary.svg':()=>secondary('primary'), 'logo-icon.svg':()=>icon('primary'),
  'logo-light.svg':()=>primary('light'), 'logo-dark.svg':()=>primary('dark'), 'logo-monochrome.svg':monochrome, 'favicon.svg':favicon, 'app-icon.svg':()=>appIcon(), 'app-icon-maskable.svg':()=>appIcon({maskable:true}) };

// CLI: node build-logos.mjs <outDir>   (needs: npm i opentype.js wawoff2 in this folder; not added to the app's package.json)
if (process.argv[1] && process.argv[1].endsWith('build-logos.mjs')) {
  const fs2=await import('node:fs'); const out=process.argv[2]; if(!out){console.error('usage: node build-logos.mjs <outDir>');process.exit(1)}
  fs2.mkdirSync(out,{recursive:true}); for (const [n,fn] of Object.entries(ALL)) fs2.writeFileSync(out.replace(/\/$/,'')+'/'+n,'<?xml version="1.0" encoding="UTF-8"?>\n'+fn()+'\n'); console.log('wrote',Object.keys(ALL).length,'files to',out);
}
