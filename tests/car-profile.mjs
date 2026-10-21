/**
 * 车身侧向轮廓检查 —— 纯侧视, 用于判断"薄片感"
 * 用法: node tests/car-profile.mjs <tag> [rocker]
 * 产出: ref/profile-<tag>.png
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';

const tag = process.argv[2] || 'now';
const OUT = path.join(ROOT, 'ref');
fs.mkdirSync(OUT, { recursive: true });

const pw = await loadPlaywright(); const srv = await serveOutputs();
const browser = await launchBrowser(pw);
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
const errors = collectErrors(page);
await page.addInitScript(m => { window.__profileMode__ = m; }, process.argv[3] || 'side');
await page.goto(srv.base + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__car__ && window.__THREE__, { timeout: 30000 });
await advanceFrames(page, 10);

await page.evaluate(() => {
  const T = window.__THREE__, car = window.__car__, sc = window.__scene__;
  window.__RD__.playing = false;
  // 关雾 + 深色背景, 只看车
  sc.fog = null;
  sc.background = new T.Color(0x0a1018);
  // 隐藏坡道/地面等干扰物, 只留车 + 灯光(灯光不能藏, 否则车身全黑)
  sc.children.forEach(c => { if (c !== car && !c.isLight) c.visible = false; });
  // 纯侧视: 相机相对【车身】定位(车在坡道上, 不能用世界原点)
  // 车身局部: -X 车头, +X 车尾, +Y 上, +Z 右
  const cp = new T.Vector3(); car.getWorldPosition(cp);
  const q  = car.getWorldQuaternion(new T.Quaternion());
  const cam = new T.PerspectiveCamera(28, 1100/620, 0.1, 100);
  // 视角由 argv[3] 决定: side(正侧) / hero(前侧45) / rear45 / low(低角度侧视)
  const mode = window.__profileMode__ || 'side';
  const OFF = {
    side:   [0,   0.58, 10.5],
    hero:   [-4.4, 0.85, 7.6],   // 前侧 45°, 展示视频主视角
    rear45: [ 4.4, 0.85, 7.6],
    low:    [-2.0, 0.05, 8.2],   // 低角度
  }[mode] || [0, 0.58, 10.5];
  cam.position.copy(new T.Vector3(OFF[0], OFF[1], OFF[2]).applyQuaternion(q).add(cp));
  cam.lookAt(new T.Vector3(0, 0.58, 0).applyQuaternion(q).add(cp));
  window.__overrideCam__ = cam;
});
await advanceFrames(page, 8);
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(OUT, `profile-${tag}.png`) });
console.log('✓ profile-' + tag + '.png');
console.log('错误:', errors.length ? errors.join('|') : '(无)');
await browser.close(); await srv.close();
