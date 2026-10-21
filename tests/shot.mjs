/**
 * 快速单点截图 —— 人工核查用
 *
 * 用法:
 *   node tests/shot.mjs <渲染时刻> [宽] [高] [输出名]
 *   node tests/shot.mjs 7.3 960 540 hang
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, ROOT } from './_harness.mjs';
import path from 'node:path';

const t = parseFloat(process.argv[2] ?? '7.3');
const W = parseInt(process.argv[3] ?? '960', 10);
const H = parseInt(process.argv[4] ?? '540', 10);
const name = process.argv[5] ?? `t${t}`;

const playwright = await loadPlaywright();
const srv = await serveOutputs();
const browser = await launchBrowser(playwright);
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(srv.base + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__RD__, { timeout: 30000 });
await advanceFrames(page, 15);
await page.evaluate(tt => { window.__RD__.seek(tt); window.__RD__.playing = false; }, t);
await advanceFrames(page, 50);          // 等相机 lerp 收敛
await page.screenshot({ path: path.join(ROOT, 'ref', 'render', `${name}.png`) });
const st = await page.evaluate(() => ({ t: +window.__RD__.t.toFixed(2), ph: window.__RD__.TL.sample(window.__RD__.t).phase, scr: window.__RD__.carScreen() }));
console.log(`${name}.png  t=${st.t} phase=${st.ph} 车在屏幕=${JSON.stringify(st.scr)}  错误=${errs.length||'无'}`);
await browser.close();
await srv.close();
