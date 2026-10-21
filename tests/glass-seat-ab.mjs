/** 玻璃透光度 x 座椅可见性 —— 最终 A/B */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';
const OUT = path.join(ROOT, 'ref', 'glass-seat-ab');
fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT,{recursive:true});
const OPS = [1.0, 0.90, 0.82, 0.72];
const pw = await loadPlaywright(); const srv = await serveOutputs();
const browser = await launchBrowser(pw);
for (const op of OPS) {
  const page = await browser.newPage({ viewport:{width:900,height:600} });
  const errors = collectErrors(page);
  await page.goto(srv.base+'/index.html',{waitUntil:'load',timeout:60000});
  await page.waitForFunction(()=>window.__car__&&window.__THREE__,{timeout:30000});
  await advanceFrames(page,8);
  await page.evaluate(()=>{window.__RD__.playing=false;window.__RD__.seek(1.2);});
  await advanceFrames(page,5);
  await page.evaluate((op)=>{
    const T=window.__THREE__,car=window.__car__;
    const cp=new T.Vector3();car.getWorldPosition(cp);
    const q=car.getWorldQuaternion(new T.Quaternion());
    const cam=new T.PerspectiveCamera(28,900/600,0.3,120);
    cam.position.copy(new T.Vector3(-2.2,3.4,2.0).applyQuaternion(q).add(cp));
    cam.lookAt(new T.Vector3(0,0.95,0).applyQuaternion(q).add(cp));
    window.__overrideCam__=cam;
    const canopy=car.userData.canopy;
    canopy.material.opacity=op; canopy.material.transparent = op<1; canopy.material.needsUpdate=true;
  }, op);
  await advanceFrames(page,8); await page.waitForTimeout(150);
  await page.screenshot({path:path.join(OUT,`op-${String(op).replace('.','_')}.png`)});
  console.log(`  ✓ op=${op}`);
  await page.close();
}
await browser.close(); await srv.close();
