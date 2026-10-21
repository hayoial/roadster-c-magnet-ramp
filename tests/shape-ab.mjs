/**
 * 侧壁照明 A/B —— 关键认知:
 *   车身侧壁法线朝【水平方向】, 而所有灯都在【上方或斜上方】
 *   => 侧壁几乎接不到任何光 -> 下半部死黑 -> 看起来像薄片
 *   唯一能照亮侧壁的: 从【正侧方水平】打的光
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';

const OUT = path.join(ROOT, 'ref', 'shape-ab');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// sideI: 侧向光强度; sideY: 侧向光相对车身的高度(0=正水平, 负=从下往上)
const VARIANTS = [
  { tag: 'A-current',        sideI: 0,   sideY: 0 },
  { tag: 'B-side1.5-y0.0',   sideI: 1.5, sideY: 0.0 },
  { tag: 'C-side2.5-y0.0',   sideI: 2.5, sideY: 0.0 },
  { tag: 'D-side2.5-y-0.4',  sideI: 2.5, sideY: -0.4 },
  { tag: 'E-side4.0-y0.0',   sideI: 4.0, sideY: 0.0 },
  { tag: 'F-side4.0-y0.6',   sideI: 4.0, sideY: 0.6 },
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
  await page.evaluate(({ sideI, sideY }) => {
    const T = window.__THREE__, car = window.__car__, sc = window.__scene__;
    const cp = new T.Vector3(); car.getWorldPosition(cp);
    const q = car.getWorldQuaternion(new T.Quaternion());
    sc.fog = null; sc.background = new T.Color(0x0a0f16);
    sc.children.forEach(c => { if (c !== car && !c.isLight) c.visible = false; });
    const cam = new T.PerspectiveCamera(22, 1100/560, 0.5, 120);
    cam.position.copy(new T.Vector3(0, 0.52, 15).applyQuaternion(q).add(cp));
    cam.lookAt(new T.Vector3(0, 0.52, 0).applyQuaternion(q).add(cp));
    window.__overrideCam__ = cam;
    if (sideI > 0) {
      // 侧向光: 放在车身局部 +Z 方向(相机同侧), 高度可调
      const p = new T.Vector3(0, sideY, 7).applyQuaternion(q).add(cp);
      const L = new T.DirectionalLight(0xdce8f6, sideI);
      L.position.copy(p);
      L.target.position.copy(cp);
      sc.add(L); sc.add(L.target);
    }
  }, v);
  await advanceFrames(page, 10);
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(OUT, `${v.tag}.png`) });
  console.log(`  ✓ ${v.tag}`);
  await page.close();
}
await browser.close(); await srv.close();
