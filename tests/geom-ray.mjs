/**
 * 用 Three.js 自己的 Raycaster 从车外向内打射线 —— 零自定义判据
 * 从相机方向打: 若能命中车身, 说明那一面是正面(朝外)
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors } from './_harness.mjs';

const pw = await loadPlaywright(); const srv = await serveOutputs();
const b = await launchBrowser(pw); const pg = await b.newPage({ viewport: { width: 600, height: 400 } });
const errs = collectErrors(pg);
await pg.goto(srv.base + '/index.html', { workUntil: 'load', timeout: 60000 });
await pg.waitForFunction(() => window.__car__ && window.__THREE__, { timeout: 30000 });
await advanceFrames(pg, 6);

const rep = await pg.evaluate(() => {
  const T = window.__THREE__, car = window.__car__;
  let body = null, bx = -1;
  car.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position) {
    o.geometry.computeBoundingBox();
    const sp = o.geometry.boundingBox.max.x - o.geometry.boundingBox.min.x;
    if (sp > bx) { bx = sp; body = o; } } });

  const rc = new T.Raycaster();
  const dir = new T.Vector3();
  const org = new T.Vector3();
  const results = [];

  // 车身局部: x=车长(-X车头), y=上, z=宽
  // 从 8 个方向向车身中心打射线
  const DIRS = [
    ['+Z 右侧', new T.Vector3(0, 0, 1)],
    ['-Z 左侧', new T.Vector3(0, 0, -1)],
    ['+Y 顶部', new T.Vector3(0, 1, 0)],
    ['-Y 底部', new T.Vector3(0, -1, 0)],
    ['-X 车头', new T.Vector3(-1, 0, 0)],
    ['+X 车尾', new T.Vector3(1, 0, 0)],
  ];
  const TARGETS = [
    ['座舱中部', new T.Vector3(0.18, 0.75, 0)],
    ['前轮拱上方', new T.Vector3(-1.30, 0.55, 0)],
    ['车鼻', new T.Vector3(-2.15, 0.60, 0)],
    ['车尾', new T.Vector3(2.15, 0.70, 0)],
  ];

  // 车身在世界里有变换 -> 局部坐标必须转到世界
  const wp = new T.Vector3(), wq = new T.Quaternion();
  body.getWorldPosition(wp); body.getWorldQuaternion(wq);
  const toWorld = (v) => v.clone().applyQuaternion(wq).add(wp);

  for (const [tn, tp] of TARGETS) {
    for (const [dn, dv] of DIRS) {
      const orgW = toWorld(tp.clone().addScaledVector(dv, 4.0));
      const dirW = dv.clone().applyQuaternion(wq).negate().normalize();
      org.copy(orgW); dir.copy(dirW);
      rc.set(org, dir);
      const hit = rc.intersectObject(body, false);
      if (!hit.length) { results.push({ t: tn, d: dn, hit: false }); continue; }
      const h = hit[0];
      // 交点处法线(世界)与射线方向的点积:
      // 正面命中 => 表面法线与射线反向 (法线对着射线来处) => dot < 0
      const n = h.face ? h.face.normal.clone() : new T.Vector3();
      const nWorld = n.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(body.matrixWorld)).normalize();
      const dot = nWorld.dot(dir);
      results.push({ t: tn, d: dn, hit: true,
        frontFacing: dot < 0, dot: +dot.toFixed(3), dist: +h.distance.toFixed(3) });
    }
  }
  return results;
});

let front = 0, back = 0, miss = 0;
for (const r of rep) {
  if (!r.hit) { miss++; console.log(`  ${r.t} / ${r.d}: 未命中`); continue; }
  if (r.frontFacing) { front++; console.log(`  ${r.t} / ${r.d}: 正面命中 ✓ (dot=${r.dot})`); }
  else { back++; console.log(`  ${r.t} / ${r.d}: 背面命中 ✗ (dot=${r.dot})`); }
}
console.log(`\n正面 ${front} / 背面 ${back} / 未命中 ${miss}`);
console.log('错误:', errs.length ? errs.join('|') : '(无)');
await b.close(); await srv.close();
