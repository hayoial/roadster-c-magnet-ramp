/**
 * 并排对照图生成 —— 原视频参考帧 vs 渲染帧
 *
 * 产出: ref/compare/ 下每个阶段的左右并排图 + 总览图
 * 上排: 原视频 (ref/video-frames/)
 * 下排: 本项目渲染 (ref/render/)
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const OUT = path.join(ROOT, 'ref', 'compare');
fs.mkdirSync(OUT, { recursive: true });

// 阶段 -> [原视频时间, 渲染标签, 要验证什么]
// ⚠️ 只用 Run one (C 形坡道倒挂, 0-23.5s)。26s 后是"踢翻车队"另一段 stunt。
const PAIRS = [
  { key: '01-approach',   v: 12.0, note: '助跑侧面: 车型轮廓 / 车头朝向' },
  { key: '02-climb',      v: 18.0, note: '上坡越过垂直: 车身与坡道贴合' },
  { key: '03-hang',       v: 19.6, note: '倒挂: 车顶朝下 + 2 条蓝束朝下' },
  { key: '04-release',    v: 20.8, note: '刚脱轨: 4 条平行光束' },
  { key: '05-firstjet',   v: 21.4, note: '脱轨后光束持续朝下' },
  { key: '06-roll-mid',   v: 22.0, note: '翻正过程中: 旋转轴线' },
  { key: '07-roll-near',  v: 22.6, note: '接近正立: 车轮/车头朝向' },
  { key: '08-cushion',    v: 23.0, note: '落地: 接地姿态与蒸汽云' },
  { key: '09-touchdown',  v: 23.3, note: '触地: 蒸汽爆开' },
];

const VF = path.join(ROOT, 'ref', 'video-frames');
const RF = path.join(ROOT, 'ref', 'render');

// 生成原视频帧
fs.mkdirSync(VF, { recursive: true });
const video = path.join(ROOT, 'ref', 'roadster-inverted-ramp.mp4');
for (const p of PAIRS) {
  const out = path.join(VF, `${p.key}.jpg`);
  if (!fs.existsSync(out)) {
    execFileSync('ffmpeg', ['-v', 'error', '-ss', String(p.v), '-i', video, '-frames:v', '1',
      '-vf', 'scale=640:-1', '-q:v', '3', out]);
  }
}

// 渲染帧
const playwright = await loadPlaywright();
const srv = await serveOutputs();
const browser = await launchBrowser(playwright);
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = collectErrors(page);
await page.goto(srv.base + '/index.html', { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__RD__ && window.__RD__.TL, { timeout: 60000 });
await advanceFrames(page, 12);

// 渲染帧时间戳 (与 index.html 的 TL 阶段对应)
// 渲染时间轴 (index.html TL): 0-2.25 approach / 2.25-3.25 climb / 3.25-6.1 capture
// / 6.1-7.15 hang / 7.15-7.65 descent / 7.65-10.8 roll / 10.8-11.45 cushion / 11.45+ landed
// 渲染时间轴 (2026-10-21 更新, holdTime 1.0 -> 0.32 后时间轴前移):
//   approach 0-2.21 / climb 2.21-3.24 / capture 3.24-6.07 / hang 6.07-6.46
//   descent 6.46-6.96 / roll 6.96-10.09 / cushion 10.09-10.75 / landed 10.75+
const RT = { '01-approach': 1.2, '02-climb': 3.4, '03-hang': 6.3, '04-release': 6.6,
             '05-firstjet': 7.2, '06-roll-mid': 8.2, '07-roll-near': 9.6, '08-cushion': 10.3, '09-touchdown': 10.9 };

for (const p of PAIRS) {
  await page.evaluate(t => { window.__RD__.seek(t); window.__RD__.playing = false; }, RT[p.key]);
  // 相机有 lerp 平滑, seek 跳变后需要额外帧让机位收敛到稳态,
  // 否则截到的是相机还在追的过渡画面(车可能不在画面内)。
  await advanceFrames(page, 45);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(RF, `${p.key}.png`) });
  console.log('✓', p.key);
}
await browser.close();
await srv.close();

// 生成左右并排
for (const p of PAIRS) {
  const v = path.join(VF, `${p.key}.jpg`), r = path.join(RF, `${p.key}.png`);
  if (!fs.existsSync(v) || !fs.existsSync(r)) continue;
  // PNG 输入需要显式 -loop 1, 否则 vstack 会提前结束
  execFileSync('ffmpeg', ['-v', 'error', '-loop', '1', '-i', v, '-loop', '1', '-i', r,
    '-filter_complex',
    '[0:v]scale=640:360,pad=640:360:0:0:0x101820,setsar=1[a];[1:v]scale=640:360,setsar=1[b];[a][b]vstack=inputs=2',
    '-frames:v', '1', '-q:v', '3', '-y', path.join(OUT, `${p.key}.jpg`)]);
}
console.log('并排图已生成:', OUT);
console.log('错误:', errors.length ? errors.join('\n') : '(无)');
