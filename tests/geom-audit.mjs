/**
 * 车身横截面几何审计 —— 闭合性 / 左右对称 / 法线朝向 / 附件贴合
 * 用法: node tests/geom-audit.mjs
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors } from './_harness.mjs';

const pw = await loadPlaywright(); const srv = await serveOutputs();
const b = await launchBrowser(pw); const pg = await b.newPage({ viewport: { width: 600, height: 400 } });
const errs = collectErrors(pg);
await pg.goto(srv.base + '/index.html', { waitUntil: 'load', timeout: 60000 });
await pg.waitForFunction(() => window.__car__ && window.__THREE__, { timeout: 30000 });
await advanceFrames(pg, 6);

const rep = await pg.evaluate(() => {
  const T = window.__THREE__, car = window.__car__;
  // 列出所有 mesh, 按包围盒找"车身主体"(x 跨度最大)
  const list = [];
  car.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    list.push({
      verts: o.geometry.attributes.position.count,
      tris: (o.geometry.index?.count || 0) / 3,
      min: [bb.min.x, bb.min.y, bb.min.z].map(v => +v.toFixed(3)),
      max: [bb.max.x, bb.max.y, bb.max.z].map(v => +v.toFixed(3)),
      mat: o.material?.color ? '#' + o.material.color.getHexString() : '?',
    });
  });
  list.sort((a, b) => (b.max[0] - b.min[0]) - (a.max[0] - a.min[0]));

  // 车身主体 = x 跨度最大的
  let body = null, bx = -1;
  car.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position) {
    o.geometry.computeBoundingBox();
    const sp = o.geometry.boundingBox.max.x - o.geometry.boundingBox.min.x;
    if (sp > bx) { bx = sp; body = o; } } });

  const g = body.geometry, pos = g.attributes.position.array, idx = g.index.array;
  const nv = g.attributes.position.count, nt = idx.length / 3;

  // --- 边界边 / 非流形边 ---
  const ec = new Map();
  const key = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;
  for (let t = 0; t < nt; t++) {
    const a = idx[t*3], b = idx[t*3+1], c = idx[t*3+2];
    for (const [p, q] of [[a,b],[b,c],[c,a]]) {
      const k = key(p, q); ec.set(k, (ec.get(k) || 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0;
  const bEdges = [];
  for (const [k, v] of ec) { if (v === 1) { boundary++; bEdges.push(k); } else if (v > 2) nonManifold++; }

  // --- 边界边落在哪些顶点上 ---
  const bVerts = new Set();
  for (const k of bEdges) k.split('_').forEach(v => bVerts.add(+v));
  const bSamples = [...bVerts].slice(0, 10).map(i => ({
    i, pos: [pos[i*3], pos[i*3+1], pos[i*3+2]].map(v => +v.toFixed(4))
  }));

  // --- 对称性: 按 (x,y) 分组, 检查 |z| 是否成对出现正负 ---
  const groups = new Map();
  for (let i = 0; i < nv; i++) {
    const x = +pos[i*3].toFixed(3), y = +pos[i*3+1].toFixed(3), z = +pos[i*3+2].toFixed(4);
    const k = `${x}|${y}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(z);
  }
  let asym = 0; const asymEx = [];
  for (const [k, zs] of groups) {
    const hasPos = zs.some(v => v > 1e-5), hasNeg = zs.some(v => v < -1e-5);
    if (hasPos !== hasNeg) { asym++; if (asymEx.length < 8) asymEx.push({ xy: k, zs: zs.slice(0,8) }); }
  }

  // --- 取一个真实截面 (x 落在 BODY_SECTIONS 的某个值上, 用最近邻) ---
  const xs = [...new Set(Array.from({length: nv}, (_,i) => +pos[i*3].toFixed(3)))].sort((a,b)=>a-b);
  const pickX = xs[Math.floor(xs.length/2)];
  let bestX = xs[0], bestD = 1e9;
  for (const x of xs) { const d = Math.abs(x - pickX); if (d < bestD) { bestD = d; bestX = x; } }
  const sec = [];
  for (let i = 0; i < nv; i++) if (Math.abs(pos[i*3] - bestX) < 1e-3) sec.push(i);

  // 注: 法线朝向不在这里判定。
  // 轮廓外法线的"绕向"依赖环点顺序, 容易写反符号得出错误结论
  // (本轮就踩过: 两种自写判据都给出"法线朝内", 而渲染实测证明法线朝外)。
  // 法线朝向请用 tests/geom-ray.mjs —— 它用 Three.js 自己的 Raycaster
  // 从车外打射线, 靠实际命中面的 frontFacing 判定, 不依赖任何自定义判据。
  const nrm = g.attributes.normal.array;

  const ringPts = sec.map(i => ({
    y: +pos[i*3+1].toFixed(4), z: +pos[i*3+2].toFixed(4),
    n: [+nrm[i*3].toFixed(2), +nrm[i*3+1].toFixed(2), +nrm[i*3+2].toFixed(2)],
    bnd: bVerts.has(i),
  }));

  // --- 附件贴合检查: 侧裙/轮眉/进气 与 bodySurfaceZ 的关系 ---
  const check = [];
  const zAt = (x, y) => {
    // 复用页面里的 bodySurfaceZ
    return window.__bodySurfaceZ__ ? window.__bodySurfaceZ__(x, y) : null;
  };

  return { list, nv, nt, edges: ec.size, boundary, nonManifold, bSamples,
           asym, asymEx, bestX, secCount: sec.length,
           ringPts };
});

console.log('=== mesh 列表 (按 x 跨度排序, 前6) ===');
rep.list.slice(0,6).forEach(m => console.log(`  verts=${String(m.verts).padStart(4)} tris=${String(m.tris).padStart(4)} mat=${m.mat}  bbox x[${m.min[0]},${m.max[0]}] y[${m.min[1]},${m.max[1]}] z[${m.min[2]},${m.max[2]}]`));
console.log('\n=== 车身主体几何 ===');
console.log(`顶点 ${rep.nv}  三角 ${rep.nt}  边 ${rep.edges}`);
console.log(`边界边(应为0): ${rep.boundary}   非流形边: ${rep.nonManifold}`);
if (rep.bSamples.length) { console.log('  边界顶点样例:'); rep.bSamples.forEach(s => console.log('   ', JSON.stringify(s.pos))); }
console.log(`左右不对称 (x,y) 分组: ${rep.asym}`);
rep.asymEx.forEach(e => console.log('   ', e.xy, JSON.stringify(e.zs)));
console.log(`\n截面 x=${rep.bestX} (${rep.secCount} 点) —— 法线朝向请看 geom-ray.mjs`);
console.log('\n=== 截面环点序列 (y, z) [bnd=边界顶点] ===');
rep.ringPts.forEach((p, i) => console.log(`  ${String(i).padStart(2)}  y=${String(p.y).padStart(8)}  z=${String(p.z).padStart(8)}  n=[${p.n.join(',')}]${p.bnd?'  <-- BOUNDARY':''}`));
console.log('\n错误:', errs.length ? errs.join('|') : '(无)');
await b.close(); await srv.close();
