/**
 * 车顶玻璃 A/B —— L: "车顶盖感觉还是90%透明, 完全能看到车内, 改成25%透明最多"
 *
 * 关键: glass 材质的 transmission=0.18 + opacity=0.86
 *   - transmission 是【物理透射】, 会绕过 opacity 继续透光
 *   - 只降 opacity 不够, 必须 transmission=0
 * 方案: transmission=0 + opacity 调暗(镀膜玻璃观感), 不加方盒子暗腔
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';

const OUT = path.join(ROOT, 'ref', 'glass-ab');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const VARIANTS = [
  { tag: 'A-current',           op: null, tr: null },
  { tag: 'B-tr0-op0.86',        op: 0.86, tr: 0.0 },
  { tag: 'C-tr0-op0.55',        op: 0.55, tr: 0.0 },
  { tag: 'D-tr0-op0.35',        op: 0.35, tr: 0.0 },
  { tag: 'E-tr0-op0.25',        op: 0.25, tr: 0.0 },
  { tag: 'F-tr0-op1.0',         op: 1.0,  tr: 0.0 },
];

const pw = await loadPlaywright(); const srv = await serveOutputs();
const browser = await launchBrowser(pw);

for (const v of VARIANTS) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 560 } });
  const errors = collectErrors(page);
  await page.goto(srv.base + '/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__car__ && window.__THREE__, { timeout: 30000 });
  await advanceFrames(page, 10);
  await page.evaluate(() => { window.__RD__.playing = false; window.__RD__.seek(1.2); });
  await advanceFrames(page, 5);
  await page.evaluate(({ op, tr }) => {
    const T = window.__THREE__, car = window.__car__, sc = window.__scene__;
    const cp = new T.Vector3(); car.getWorldPosition(cp);
    const q = car.getWorldQuaternion(new T.Quaternion());
    sc.fog = null; sc.background = new T.Color(0x0a0f16);
    sc.children.forEach(c => { if (c !== car && !c.isLight) c.visible = false; });
    const cam = new T.PerspectiveCamera(30, 1100/560, 0.5, 120);
    cam.position.copy(new T.Vector3(-3.4, 3.0, 4.6).applyQuaternion(q).add(cp));
    cam.lookAt(new T.Vector3(0, 0.95, 0).applyQuaternion(q).add(cp));
    window.__overrideCam__ = cam;
    let canopy = null;
    car.traverse(o => { if (o.userData && o.userData.canopy) canopy = o.userData.canopy; });
    if (tr !== null) { canopy.material.transmission = tr; canopy.material.needsUpdate = true; }
    if (op !== null) { canopy.material.opacity = op; canopy.material.transparent = op < 1; canopy.material.needsUpdate = true; }
  }, v);
  await advanceFrames(page, 10);
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(OUT, `${v.tag}.png`) });
  console.log(`  ✓ ${v.tag}`);
  await page.close();
}
await browser.close(); await srv.close();
