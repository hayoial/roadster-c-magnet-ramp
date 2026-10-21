/**
 * 车顶俯视检查 —— 验证"看不穿车内"
 * 用法: node tests/roof-check.mjs <tag>
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';

const tag = process.argv[2] || 'now';
const OUT = path.join(ROOT, 'ref', `roof-${tag}`);
fs.mkdirSync(OUT, { recursive: true });

const VIEWS = [
  ['top45',  -3.4, 3.0, 4.6, 30],
  ['top',     0,   5.0, 0.2, 28],
  ['front45',-3.6, 1.2, 4.2, 30],
];

const pw = await loadPlaywright(); const srv = await serveOutputs();
const browser = await launchBrowser(pw);
const page = await browser.newPage({ viewport: { width: 1100, height: 560 } });
const errors = collectErrors(page);
await page.goto(srv.base + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__car__ && window.__THREE__, { timeout: 30000 });
await advanceFrames(page, 10);
await page.evaluate(() => { window.__RD__.playing = false; window.__RD__.seek(1.2); });
await advanceFrames(page, 5);

for (const [name, ox, oy, oz, fov] of VIEWS) {
  await page.evaluate(({ ox, oy, oz, fov }) => {
    const T = window.__THREE__, car = window.__car__, sc = window.__scene__;
    const cp = new T.Vector3(); car.getWorldPosition(cp);
    const q = car.getWorldQuaternion(new T.Quaternion());
    sc.fog = null; sc.background = new T.Color(0x0a0f16);
    sc.children.forEach(c => { if (c !== car && !c.isLight) c.visible = false; });
    const cam = new T.PerspectiveCamera(fov, 1100/560, 0.5, 120);
    cam.position.copy(new T.Vector3(ox, oy, oz).applyQuaternion(q).add(cp));
    cam.lookAt(new T.Vector3(0, 0.95, 0).applyQuaternion(q).add(cp));
    window.__overrideCam__ = cam;
  }, { ox, oy, oz, fov });
  await advanceFrames(page, 10);
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}
console.log('错误:', errors.length ? errors.join('|') : '(无)');
await browser.close(); await srv.close();
