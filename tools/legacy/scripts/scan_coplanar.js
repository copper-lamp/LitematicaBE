const fs=require('fs'),path=require('path');
const dir='resources/addon/LitematicaBE_RP/models/blocks';
const hits=[];
for(const f of fs.readdirSync(dir).filter(n=>n.endsWith('.json'))){
  let j; try{ j=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); }catch(e){ continue; }
  for(const g of (j['minecraft:geometry']||[])){
    for(const b of (g.bones||[])){
      const cs=(b.cubes||[]).filter(c=>!c.rotation);
      for(let i=0;i<cs.length;i++) for(let k=i+1;k<cs.length;k++){
        const A=cs[i],B=cs[k];
        const ax0=A.origin[0],ax1=ax0+A.size[0],az0=A.origin[2],az1=az0+A.size[2];
        const bx0=B.origin[0],bx1=bx0+B.size[0],bz0=B.origin[2],bz1=bz0+B.size[2];
        const oy=A.origin[1]+A.size[1], oy2=B.origin[1]+B.size[1];
        if(Math.abs(oy-oy2)>1e-6) continue;
        const ox=Math.min(ax1,bx1)-Math.max(ax0,bx0);
        const oz=Math.min(az1,bz1)-Math.max(az0,bz0);
        if(ox>1e-6&&oz>1e-6) hits.push(`${f} 顶面 y=${oy} 重叠 ${ox.toFixed(2)}x${oz.toFixed(2)} (cubes ${i}/${k})`);
      }
    }
  }
}
console.log(hits.length?hits.join('\n'):'无真正的顶面共面');
