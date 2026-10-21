/** 车顶特写 —— 验证四个座椅是否可辨识 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';
const OUT = path.join(ROOT, 'ref', 'seat-closeup');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const pw = await loadPlaywright(); const srv = await serveOutputs();
const browser = await launchBrowser(pw);
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = collectErrors(page);
await page.goto(srv.base + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__car__ && window.__THREE__, { timeout: 30000 });
await advanceFrames(page, 10);
await page.evaluate(() => { window.__RD__.playing = false; window.__RD__.seek(1.2); });
await advanceFrames(page, 5);
// 三个角度: 俯视 / 前 45 / 侧后 45
const ANGLES = [
  { tag: 'top',    pos: [0.2, 5.2, 0.1],  look: [0.05, 0.95, 0], fov: 26 },
  { tag: 'front45',pos: [-2.6, 2.4, 2.2], look: [-0.1, 0.95, 0], fov: 30 },
  { tag: 'rear45', pos: [2.4, 2.0, 2.4],  look: [0.3, 0.95, 0],  fov: 30 },
];
for (const a of ANGLES) {
  await page.evaluate((a) => {
    const T = window.__THREE__, car = window.__car__, sc = window.__scene__;
    const cp = new T.Vector3(); car.getWorldPosition(cp);
    const q = car.getWorldQuaternion(new T.Quaternion());
    const cam = new T.PerspectiveCamera(a.fov, 1100/700, 0.3, 120);
    cam.position.copy(new T.Vector3(...a.pos).applyQuaternion(q).add(cp));
    cam.lookAt(new T.Vector3(...a.look).applyQuaternion(q).add(cp));
    window.__overrideCam__ = cam;
  }, a);
  await advanceFrames(page, 8);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, `${a.tag}.png`) });
  console.log('  ✓ ' + a.tag);
}
console.log(errors.length ? '错误: ' + errors.join('; ') : '错误: (无)');
await browser.close(); await srv.close();
