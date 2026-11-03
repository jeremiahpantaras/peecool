// Peecool symbol geometry ("The Bounce"). Grid: 120 x 120.
export const P = { T:[12,12], V:[50,92], R:[84,50], wT:3, wV:22, wR:22, yb:99, gap:5, ballR:17, lineY:[104,110], lineX:[6,114] };
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]], sub=(a,b)=>[a[0]-b[0],a[1]-b[1]], mul=(a,k)=>[a[0]*k,a[1]*k];
const len=a=>Math.hypot(a[0],a[1]), unit=a=>mul(a,1/len(a));
const left=d=>[d[1],-d[0]]; // normal pointing to screen-left of travel direction (y down)
function inter(p1,d1,p2,d2){ const det=d1[0]*d2[1]-d1[1]*d2[0]; const t=((p2[0]-p1[0])*d2[1]-(p2[1]-p1[1])*d2[0])/det; return add(p1,mul(d1,t)); }
const f=n=>+n.toFixed(2);
export function symbol(o={}) {
  const p={...P,...o};
  const dL=unit(sub(p.V,p.T)), nL=left(dL);          // down-arm
  const dR=unit(sub(p.R,p.V)), nR=left(dR);          // up-arm
  // edge lines (point + direction)
  // nL points to the INSIDE of the chevron (toward the right arm), so inside edge = +nL
  const Lin=[add(p.T,mul(nL,p.wT/2)), dL], Lout=[sub(p.T,mul(nL,p.wT/2)), dL];
  // widen toward V: use second point on each edge
  const Lin2=add(p.V,mul(nL,p.wV/2)), Lout2=sub(p.V,mul(nL,p.wV/2));
  const LoutD=unit(sub(Lout2,Lout[0])), LinD=unit(sub(Lin2,Lin[0]));
  const Rout=[sub(p.V,mul(nR,p.wV/2)), dR], Rin=[add(p.V,mul(nR,p.wV/2)), dR]; // out=right/below, in=left/above
  const notch=inter(Lin[0],LinD,Rin[0],dR);
  const Ltop=[Lout[0],Lin[0]];
  const yb=p.yb, atY=(pt,d)=>add(pt,mul(d,(yb-pt[1])/d[1]));
  const bl=atY(Lout[0],LoutD), br=atY(Rout[0],dR);
  const Rend_in=add(p.R,mul(nR,p.wR/2)), Rend_out=sub(p.R,mul(nR,p.wR/2));
  const pts=[Ltop[0],Ltop[1],notch,Rend_in,Rend_out,br,bl];
  const d='M'+pts.map(q=>f(q[0])+' '+f(q[1])).join('L')+'Z';
  const c=add(p.R,mul(dR,p.gap+p.ballR));
  const hole=2.1, ring=8.6, holes=[[0,0],...[0,1,2,3,4,5].map(i=>[Math.cos(i*Math.PI/3+0.3)*ring,Math.sin(i*Math.PI/3+0.3)*ring])].map(h=>[c[0]+h[0],c[1]+h[1]]);
  return { v:d, ball:{cx:f(c[0]),cy:f(c[1]),r:p.ballR}, holes:holes.map(h=>[f(h[0]),f(h[1]),hole]), line:{x:p.lineX[0],y:p.lineY[0],w:p.lineX[1]-p.lineX[0],h:p.lineY[1]-p.lineY[0]}, pts, c };
}
// ball path with perforation holes cut out (even-odd), as a single <path>
export function ballPath(b,holes){ const circ=(cx,cy,r)=>`M${f(cx-r)} ${f(cy)}a${r} ${r} 0 1 0 ${f(2*r)} 0a${r} ${r} 0 1 0 ${f(-2*r)} 0Z`; return circ(+b.cx,+b.cy,b.r)+holes.map(h=>circ(h[0],h[1],h[2])).join(''); }
