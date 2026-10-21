/** 逐个隐藏, 定位座舱里的黑块到底是什么 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';
const OUT = path.join(ROOT, 'ref', 'isolate'); fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT,{recursive:true});
const pw = await loadPlaywright(); const srv = await serveOutputs();
const browser = await launchBrowser(pw);
const page = await browser.newPage({ viewport:{width:900,height:600} });
const errors = collectErrors(page);
await page.goto(srv.base+'/index.html',{waitUntil:'load',timeout:60000});
await page.waitForFunction(()=>window.__car__&&window.__THREE__,{timeout:30000});
await advanceFrames(page,10);
await page.evaluate(()=>{window.__RD__.playing=false;window.__RD__.seek(1.2);});
await advanceFrames(page,5);
await page.evaluate(()=>{
  const T=window.__THREE__,car=window.__car__,sc=window.__scene__;
  const cp=new T.Vector3();car.getWorldPosition(cp);
  const q=car.getWorldQuaternion(new T.Quaternion());
  const cam=new T.PerspectiveCamera(28,900/600,0.3,120);
  cam.position.copy(new T.Vector3(-2.2,3.4,2.0).applyQuaternion(q).add(cp));
  cam.lookAt(new T.Vector3(0,0.95,0).applyQuaternion(q).add(cp));
  window.__overrideCam__=cam;
  // 列出 car 的所有子节点类型
  const info=[];
  car.children.forEach((c,i)=>{
    info.push({i, type:c.type, geo:c.geometry?.type,
      params: c.geometry?.parameters ? Object.entries(c.geometry.parameters).map(([k,v])=>k+'='+(typeof v==='number'?v.toFixed(3):v)).join(',') : null,
      pos:[c.position.x.toFixed(2),c.position.y.toFixed(2),c.position.z.toFixed(2)],
      kids:c.children.length});
  });
  window.__NODEINFO__=info;
});
await advanceFrames(page,5);
console.log(JSON.stringify(await page.evaluate(()=>window.__NODEINFO__),null,1));
await page.screenshot({path:path.join(OUT,'all.png')});
// 逐个隐藏前 30 个几何节点
for (let i=0;i<30;i++){
  await page.evaluate((i)=>{ const c=window.__car__.children[i]; if(c) c.visible=false; }, i);
  await advanceFrames(page,3);
  await page.screenshot({path:path.join(OUT,`hide-${String(i).padStart(2,'0')}.png`)});
}
console.log(errors.length?'错误: '+errors.join(';'):'错误: (无)');
await browser.close(); await srv.close();
