// Single source of truth for brand colours; contrast checked here, copied into docs.
export const brand = {
  'court-950':'#06150D','court-900':'#082015','court-800':'#0B2D1C','court-700':'#0D3F27','court-600':'#1A5435','leaf-500':'#41702E',
  'lime-300':'#D9F27A','lime-400':'#C4E94A','lime-500':'#A8CF2C','volt-300':'#F4FB5A',
  'mint-100':'#E8F4E7','mint-50':'#F1F8EA','cream-50':'#F8FFEF','sage-200':'#CBD9C9','sage-300':'#B2C6B0','ink':'#0F1A13','white':'#FFFFFF'
};
export const light = { bg:'#F8FFEF', surface:'#FFFFFF', surface2:'#EEF6E8', border:'#D3E0CF', text:'#0F1A13', muted:'#46594C',
  primary:'#0D3F27', primaryInk:'#FFFFFF', accent:'#C4E94A', accentInk:'#0F1A13',
  teamA:'#1E3FAE', teamATint:'#DCE7FF', teamB:'#8A2E0E', teamBTint:'#FFEEDD',
  success:'#166534', successTint:'#DDF5E3', warn:'#8A4B00', warnTint:'#FFF0C9', danger:'#B42318', dangerTint:'#FDE4E1', info:'#0B5CAD', infoTint:'#DCEEFC' };
export const dark = { bg:'#06150D', surface:'#0B2D1C', surface2:'#123B27', border:'#27503A', text:'#F4FBEA', muted:'#A9C0AE',
  primary:'#C4E94A', primaryInk:'#06150D', accent:'#C4E94A', accentInk:'#06150D',
  teamA:'#8FC1FF', teamATint:'#102A52', teamB:'#FFA36B', teamBTint:'#4A2010',
  success:'#7DE39A', successTint:'#0F3A22', warn:'#FFC857', warnTint:'#4A3406', danger:'#FF8E83', dangerTint:'#4A1713', info:'#7FC0FF', infoTint:'#0E2F52' };
export const lum=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
export const cr=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05);};
