/**
 * 四座椅 A/B —— 验证"座舱有内容"对厚度感/结构感的贡献
 *
 * 空间约束: 井口 y=0.845, 井底 y=0.585 (深 0.30)
 *   真实比例座椅(坐垫+靠背 0.62m)塞不下 -> 座椅做矮, 只露靠背顶部
 * 玻璃要【略微透】(不是90%透明), 让座椅若隐若现
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';

const OUT = path.join(ROOT, 'ref', 'seat-ab');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// glassOp: 玻璃不透明度; seats: 是否加座椅
const VARIANTS = [
  { tag: 'A-noSeats-op1.0',  glassOp: 1.0,  seats: false },
  { tag: 'B-seats-op1.0',    glassOp: 1.0,  seats: true },
  { tag: 'C-seats-op0.88',  glassOp: 0.88, seats: true },
  { tag: 'D-seats-op0.80',  glassOp: 0.80, seats: true },
  { tag: 'E-seats-op0.68',  glassOp: 0.68, seats: true },
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
  await page.evaluate(({ glassOp, seats }) => {
    const T = window.__THREE__, car = window.__car__, sc = window.__scene__;
    const cp = new T.Vector3(); car.getWorldPosition(cp);
    const q = car.getWorldQuaternion(new T.Quaternion());
    sc.fog = null; sc.background = new T.Color(0x0a0f16);
    sc.children.forEach(c => { if (c !== car && !c.isLight) c.visible = false; });
    const cam = new T.PerspectiveCamera(30, 1100/560, 0.5, 120);
    cam.position.copy(new T.Vector3(-3.4, 3.0, 4.6).applyQuaternion(q).add(cp));
    cam.lookAt(new T.Vector3(0, 0.95, 0).applyQuaternion(q).add(cp));
    window.__overrideCam__ = cam;
    // 玻璃不透明度
    const canopy = car.userData.canopy;
    canopy.material.opacity = glassOp;
    canopy.material.transparent = glassOp < 1;
    canopy.material.needsUpdate = true;
    if (seats) {
      // 四个座椅剪影: 座垫 + 靠背, 做矮, 只露靠背顶部
      const seatMat = new T.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.82, metalness: 0.12 });
      const backMat = new T.MeshStandardMaterial({ color: 0x222a34, roughness: 0.78, metalness: 0.14 });
      const SEATS = [[-0.30, 0.24], [-0.30, -0.24], [0.46, 0.22], [0.46, -0.22]];
      for (const [sx, sz] of SEATS) {
        // 靠背(略后倾)
        const back = new T.Mesh(new T.BoxGeometry(0.10, 0.30, 0.40), backMat);
        back.position.set(sx + 0.16, 0.735, sz);
        back.rotation.z = -0.22;
        car.add(back);
        // 坐垫
        const cushion = new T.Mesh(new T.BoxGeometry(0.38, 0.09, 0.40), seatMat);
        cushion.position.set(sx, 0.645, sz);
        car.add(cushion);
      }
    }
  }, v);
  await advanceFrames(page, 10);
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(OUT, `${v.tag}.png`) });
  console.log(`  ✓ ${v.tag}`);
  await page.close();
}
await browser.close(); await srv.close();
