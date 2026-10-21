/**
 * 逐时刻喷口激活清单
 *
 * 对照原视频 19.6 / 20.4 / 20.8 / 21.2 / 21.4 / 22.0 / 22.5 / 23.0 / 23.3 秒,
 * 输出本项目对应渲染时刻的实际喷口状态, 并与视频可见事实对照。
 *
 * 产出: ref/nozzle-timeline.md + 终端表格
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const playwright = await loadPlaywright();
const srv = await serveOutputs();
const browser = await launchBrowser(playwright);
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = collectErrors(page);
await page.goto(srv.base + '/index.html', { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__RD__ && window.__nozzles__, { timeout: 60000 });
await advanceFrames(page, 20);

// [原视频时刻, 本项目渲染时刻, 视频可见光束数(描述), 视频方向描述]
// 渲染时刻 2026-10-21 更新 (holdTime 1.0 -> 0.32, 时间轴前移 ~0.7s)
const ROWS = [
  { v: 19.6, t: 6.30, n: '2 条', dir: '斜下外张' },
  { v: 20.4, t: 6.60, n: '1 条', dir: '后下方' },
  { v: 20.8, t: 6.90, n: '2 条', dir: '后下方' },
  { v: 21.2, t: 7.20, n: '2 条', dir: '后下方' },
  { v: 21.4, t: 7.60, n: '3 条', dir: '向下' },
  { v: 22.0, t: 8.60, n: '3 条', dir: '向下' },
  { v: 22.5, t: 9.60, n: '3-4 条 + 白雾', dir: '向下' },
  { v: 23.0, t: 10.30, n: '大团蒸汽云', dir: '向下' },
  { v: 23.3, t: 10.90, n: '蒸汽爆开', dir: '—' },
];

const md = [];
md.push('# 逐时刻喷口激活清单');
md.push('');
md.push('> 由 `node tests/nozzle-timeline.mjs` 自动生成, 数值直接读自运行时。');
md.push('');
md.push('| 原视频 | 渲染时刻 | 阶段 | 车顶 up.y | 视频可见光束 | 视频方向 | 本项目激活喷口 (worldDir.y) | 方向判定 |');
md.push('|--------|---------|------|----------|-------------|---------|------------------------------|---------|');

console.log('\n时刻    阶段      up.y    激活喷口');
const detail = [];
for (const r of ROWS) {
  await page.evaluate(tt => { window.__RD__.seek(tt); window.__RD__.playing = false; }, r.t);
  await advanceFrames(page, 45);
  const s = await page.evaluate(() => {
    const RD = window.__RD__; const st = RD.TL.sample(RD.t);
    return { ph: st.phase, upy: st.up.y, nz: window.__nozzles__() };
  });
  const act = s.nz.filter(n => n.intensity > 0.05);
  const desc = act.map(n => `${n.id}(y=${n.worldDir[1].toFixed(2)},I=${n.intensity.toFixed(2)})`).join('<br>') || '—';
  // 方向判定: 所有激活喷口的 worldDir.y
  const downs = act.filter(n => n.worldDir[1] < 0);
  const judge = act.length === 0 ? '无喷流' :
    (downs.length === act.length ? '全部朝下 ✓' : `混合(${downs.length}/${act.length} 朝下)`);
  console.log(`${r.v}s→${r.t}s ${s.ph.padEnd(9)} ${s.upy.toFixed(2).padStart(5)}  ${desc}`);
  detail.push({ ...r, ph: s.phase, upy: s.upy, act: act.map(n => ({
    id: n.id, type: n.type, wy: +n.worldDir[1].toFixed(3), I: +n.intensity.toFixed(3),
    wp: n.worldPos, dir: n.worldDir })) });
  md.push(`| ${r.v}s | ${r.t}s | ${s.ph} | ${s.upy.toFixed(2)} | ${r.n} | ${r.dir} | ${desc} | ${judge} |`);
}

md.push('');
md.push('## 说明');
md.push('');
md.push('- **"配置中存在" ≠ "当前激活" ≠ "画面中可见"**:');
md.push('  - 配置: `NOZZLE_DEFS` 共 7 个喷口;');
md.push('  - 激活: 上表列出 `intensity > 0.05` 的喷口;');
md.push('  - 可见: 光束可能被车身遮挡(倒挂时甲板侧喷流在车体远侧)或离开画面,');
md.push('    因此**画面中可见的条数通常少于激活数**。');
md.push('- `under-core` 只在 `cushion` 激活 —— 车辆翻正后车底才朝向世界下方,');
md.push('  倒挂期间激活它会得到朝上的错误推力。');
md.push('- 主喷流(`deck-*`)受 `up.y` 约束: 倒挂时全功率朝下, 翻正后自动停用。');
md.push('');

fs.writeFileSync(path.join(ROOT, 'ref', 'nozzle-timeline.md'), md.join('\n'), 'utf8');
console.log('\n已写出 ref/nozzle-timeline.md');
console.log('页面错误:', errors.length ? errors.join('|') : '(无)');
await browser.close();
await srv.close();
process.exit(errors.length ? 1 : 0);
