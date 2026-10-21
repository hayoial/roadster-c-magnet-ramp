/**
 * 灯光 A/B —— 决定性测试: 每个变体只改【一个】变量
 * 变体: hemi(半球光) 强度 / key 主光强度
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';

const OUT = path.join(ROOT, 'ref', 'mat-ab');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const VARIANTS = [
  { tag: 'A-base',        hemi: null, key: null, rim: null, fill: null, carFill: null },
  { tag: 'B-key260',      hemi: null, key: 260,  rim: null, fill: null, carFill: null },
  { tag: 'C-key180',      hemi: null, key: 180,  rim: null, fill: null, carFill: null },
  { tag: 'D-key260-fill1.2', hemi: null, key: 260, rim: null, fill: 1.2, carFill: 0.9 },
  { tag: 'E-key180-fill1.6', hemi: null, key: 180, rim: null, fill: 1.6, carFill: 1.2 },
];

const pw = await loadPlaywright(); const srv = await serveOutputs();
const browser = await launchBrowser(pw);

for (const v of VARIANTS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = collectErrors(page);
  await page.goto(srv.base + '/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__car__ && window.__THREE__, { timeout: 30000 });
  await advanceFrames(page, 10);
  // 先定格时间, 让运动学跑完
  await page.evaluate(() => { window.__RD__.playing = false; window.__RD__.seek(1.2); });
  await advanceFrames(page, 4);
  const applied = await page.evaluate(({ hemi, key, rim, fill, carFill }) => {
    const T = window.__THREE__, car = window.__car__, sc = window.__scene__;
    const cp = new T.Vector3(); car.getWorldPosition(cp);
    const q = car.getWorldQuaternion(new T.Quaternion());
    const cam = new T.PerspectiveCamera(28, 900/600, 0.1, 100);
    cam.position.copy(new T.Vector3(-4.4, 0.85, 7.6).applyQuaternion(q).add(cp));
    cam.lookAt(new T.Vector3(0, 0.58, 0).applyQuaternion(q).add(cp));
    window.__overrideCam__ = cam;
    const log = [];
    sc.traverse(l => {
      if (l.isHemisphereLight && hemi !== null) { l.intensity = hemi; log.push(`hemi=${hemi}`); }
      if (l.isSpotLight && l.intensity > 600 && key !== null) { l.intensity = key; log.push(`key=${key}`); }
      else if (l.isSpotLight && l.intensity > 400 && rim !== null) { l.intensity = rim; log.push(`rim=${rim}`); }
      else if (l.isDirectionalLight && Math.abs(l.intensity - 0.48) < 0.01 && fill !== null) { l.intensity = fill; log.push(`fill=${fill}`); }
      else if (l.isDirectionalLight && Math.abs(l.intensity - 0.38) < 0.01 && carFill !== null) { l.intensity = carFill; log.push(`carFill=${carFill}`); }
    });
    return log;
  }, v);
  await advanceFrames(page, 12);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, `${v.tag}.png`) });
  console.log(`  ✓ ${v.tag}  应用=${applied.join(',')||'无'}  错误:${errors.length||'无'}`);
  await page.close();
}
await browser.close(); await srv.close();
