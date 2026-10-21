/**
 * 车身体量检查 —— 独立相机绕车拍多视角, 不受动画时间轴影响
 * 用法: node tests/car-inspect.mjs <tag>
 * 产出: ref/inspect-<tag>/*.png
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';

const tag = process.argv[2] || 'now';
const OUT = path.join(ROOT, 'ref', `inspect-${tag}`);
fs.mkdirSync(OUT, { recursive: true });

// [名称, ox, oy, oz, fov] —— 相对车身中心
// [名称, ox(车长轴), oy(上), oz(宽轴), fov] —— 车身局部坐标
// 车身局部: -X 车头, +X 车尾, +Y 车顶, +Z 右侧
const VIEWS = [
  ['side',       0,    0.50, 5.4, 30],
  ['side-low',   0,    0.10, 4.6, 32],
  ['front45',   -2.6,  0.60, 3.6, 32],
  ['rear45',     2.6,  0.60, 3.6, 32],
  ['front',     -5.2,  0.50, 0,   30],
  ['rear',       5.2,  0.50, 0,   30],
  ['top',        0,    5.2,  0.05, 30],
  ['lowhero',   -1.6, -0.35, 3.4, 36],
];

const pw = await loadPlaywright(); const srv = await serveOutputs();
const browser = await launchBrowser(pw);
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = collectErrors(page);
await page.goto(srv.base + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__car__ && window.__THREE__, { timeout: 30000 });
await advanceFrames(page, 10);

// 停掉主相机控制, 接管渲染
await page.evaluate(() => {
  window.__RD__.playing = false;
  window.__RD__.seek(1.2);
});

for (const [name, ox, oy, oz, fov] of VIEWS) {
  await page.evaluate(({ ox, oy, oz, fov }) => {
    const T = window.__THREE__;
    const car = window.__car__;
    // 车身在世界里的位置与朝向(车在坡道上, 航向是斜的!)
    const cp = new T.Vector3();
    car.getWorldPosition(cp);
    const q = car.getWorldQuaternion(new T.Quaternion());
    const cam = window.__inspectCam__ || (window.__inspectCam__ = new T.PerspectiveCamera(fov, 900/600, 0.1, 100));
    cam.fov = fov; cam.aspect = 900/600; cam.updateProjectionMatrix();
    // 偏移定义在【车身自身坐标系】: x=车长方向, y=上, z=宽
    // 车身局部: -X 车头, +X 车尾, +Y 车顶, +Z 右侧
    const local = new T.Vector3(ox, oy, oz);
    const world = local.applyQuaternion(q).add(cp);
    cam.position.copy(world);
    // 目标点也在车身坐标系: 车身中心稍上
    const target = new T.Vector3(0, 0.10, 0).applyQuaternion(q).add(cp);
    cam.lookAt(target);
    window.__inspectCam__ = cam;
    window.__overrideCam__ = cam;
  }, { ox, oy, oz, fov });
  await advanceFrames(page, 8);
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('  ✓', name);
}
console.log('错误:', errors.length ? errors.join('|') : '(无)');
await browser.close(); await srv.close();
process.exit(errors.length ? 1 : 0);
