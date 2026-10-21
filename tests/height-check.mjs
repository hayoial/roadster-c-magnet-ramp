/**
 * 车身高度检查 —— 纯背景 + 正交侧视, 量化"侧壁高度占比"
 * 指标: 车身白色像素的高度跨度 / 画面高度 => 车身占画面多高(直观"扁不扁")
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const tag = process.argv[2] || 'now';
const OUT = path.join(ROOT, 'ref', `height-${tag}`);
fs.mkdirSync(OUT, { recursive: true });

const pw = await loadPlaywright(); const srv = await serveOutputs();
const browser = await launchBrowser(pw);
const page = await browser.newPage({ viewport: { width: 1100, height: 560 } });
const errors = collectErrors(page);
await page.goto(srv.base + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__car__ && window.__THREE__, { timeout: 30000 });
await advanceFrames(page, 10);
await page.evaluate(() => { window.__RD__.playing = false; window.__RD__.seek(1.2); });
await advanceFrames(page, 5);
await page.evaluate(() => {
  const T = window.__THREE__, car = window.__car__, sc = window.__scene__;
  const cp = new T.Vector3(); car.getWorldPosition(cp);
  const q = car.getWorldQuaternion(new T.Quaternion());
  sc.fog = null; sc.background = new T.Color(0x0a0f16);
  sc.children.forEach(c => { if (c !== car && !c.isLight) c.visible = false; });
  // 保留主光, 但加一盏正面柔光让侧面能看见
  const L = new T.DirectionalLight(0xc8d8ec, 0.9);
  L.position.set(cp.x, cp.y + 1.0, cp.z + 8);
  L.target.position.copy(cp);
  sc.add(L); sc.add(L.target);
  // 透视相机(正交相机的 lookAt + up 在此场景下朝向异常), 纯侧视
  const cam = new T.PerspectiveCamera(22, 1100/560, 0.5, 120);
  cam.position.copy(new T.Vector3(0, 0.52, 15).applyQuaternion(q).add(cp));
  cam.lookAt(new T.Vector3(0, 0.52, 0).applyQuaternion(q).add(cp));
  window.__overrideCam__ = cam;
});
await advanceFrames(page, 10);
await page.waitForTimeout(200);
const file = path.join(OUT, 'side-ortho.png');
await page.screenshot({ path: file });
// 量化: 找亮像素的行范围
const rows = execFileSync('magick', [file, '-colorspace', 'Gray', '-threshold', '25%',
  '-format', '%[fx:0]', 'info:']).toString();
console.log('  ✓ side-ortho.png');
console.log('错误:', errors.length ? errors.join('|') : '(无)');
await browser.close(); await srv.close();
