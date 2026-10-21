/**
 * 视觉对照工作流 — 固定诊断机位渲染关键帧
 *
 * 用法: node tests/visual-reference.mjs
 * 产出: ref/render/ 下的关键帧 PNG + ref/render/manifest.json
 *
 * 关键帧时间戳来自原视频 (ref/REFERENCE-FRAMES.md)。
 * 诊断机位为固定侧视机位, 保证参考帧与渲染帧能对比车身轮廓与姿态。
 */
import { chromium } from '/Users/shuai/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'ref', 'render');
fs.mkdirSync(OUT, { recursive: true });

// 关键帧: 时刻(渲染时间) + 标签 + 原视频对应时刻 + 要验证什么
const KEYS = [
  { t: 0.60,  label: '01-approach',   note: '助跑起始，车头朝前' },
  { t: 1.80,  label: '02-approach',   note: '助跑，侧面轮廓与比例' },
  { t: 2.60,  label: '03-climb',      note: '上坡，车身贴合坡道' },
  { t: 3.60,  label: '04-capture',    note: '磁吸捕获，接近倒挂' },
  { t: 5.20,  label: '05-hang',       note: '完全倒挂（车顶朝下）' },
  { t: 6.60,  label: '06-hang',       note: '倒挂保持' },
  { t: 7.30,  label: '07-release',    note: '刚脱轨，首次喷气' },
  { t: 8.40,  label: '08-roll-mid',   note: '空中旋转中段' },
  { t: 9.60,  label: '09-roll-near',  note: '接近正立' },
  { t: 10.60, label: '10-cushion',    note: '缓降，向下喷气' },
  { t: 11.70, label: '11-touchdown',  note: '触地' },
];

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({
  headless: true, executablePath: CHROME,
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

const BASE = process.env.RD_BASE || 'http://localhost:8765';
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__RD__ && window.__RD__.TL, { timeout: 60000 });

// 预热: 先跑几帧, 避免第一张截图抓到未绘制的首帧
await page.evaluate(() => new Promise(res => {
  let n = 0;
  const tick = () => { if (++n >= 10) res(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}));

const manifest = [];
for (const k of KEYS) {
  await page.evaluate((t) => { window.__RD__.seek(t); window.__RD__.playing = false; }, k.t);
  // 等若干帧让插值稳定 —— 必须等到 rAF 真的跑过,
  // 否则 seek 后立刻截图会抓到尚未绘制的首帧(表现为全白)。
  await page.evaluate(() => new Promise(res => {
    let n = 0;
    const tick = () => { if (++n >= 6) res(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
  await page.waitForTimeout(120);
  const file = path.join(OUT, `${k.label}.png`);
  await page.screenshot({ path: file });
  const st = await page.evaluate(() => ({
    pos: window.__RD__.carPos(),
    basis: window.__RD__.carBasis(),
    quat: window.__RD__.quat(),
  }));
  manifest.push({ ...k, file: path.relative(ROOT, file), state: st });
  console.log(`✓ ${k.label}  t=${k.t.toFixed(2)}  pos=(${st.pos.x},${st.pos.y},${st.pos.z})  up=(${st.basis.up.x.toFixed(3)},${st.basis.up.y.toFixed(3)},${st.basis.up.z.toFixed(3)})`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('\n错误:', errors.length ? errors.join('\n') : '(无)');
await browser.close();
process.exit(errors.length ? 1 : 0);
