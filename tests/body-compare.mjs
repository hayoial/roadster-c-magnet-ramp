/**
 * 车身体量对比 —— 同机位截取, 用于 before/after 目视比较
 * 用法: node tests/body-compare.mjs <tag>
 * 产出: ref/body-<tag>/*.png
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';

const tag = process.argv[2] || 'now';
const OUT = path.join(ROOT, 'ref', `body-${tag}`);
fs.mkdirSync(OUT, { recursive: true });

// 三个关键镜头: 跟车(TRACKING) / 倒挂(LOW HERO) / 喷气(TRACKING 脱轨)
const SHOTS = [
  { t: 1.2,  v: 0, name: '01-tracking' },
  { t: 5.2,  v: 1, name: '02-inverted' },
  { t: 7.4,  v: 0, name: '03-jet' },
  { t: 10.6, v: 1, name: '04-cushion' },
];

const pw = await loadPlaywright(); const srv = await serveOutputs();
const browser = await launchBrowser(pw);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = collectErrors(page);
await page.goto(srv.base + '/index.html?demo=1', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__RD__, { timeout: 30000 });
await advanceFrames(page, 20);

for (const s of SHOTS) {
  await page.evaluate(({t, v}) => {
    window.__RD__.demo.seek(t);
    window.__RD__.playing = false;
    window.__RD__.setView(v);
  }, s);
  await advanceFrames(page, 45);
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT, `${s.name}.png`) });
  const st = await page.evaluate(() => ({ v: window.__RD__.viewIdx, t: +window.__RD__.t.toFixed(2) }));
  console.log(`  ${s.name}  t=${st.t}  view=${st.v}`);
}
console.log('错误:', errors.length ? errors.join('|') : '(无)');
await browser.close(); await srv.close();
process.exit(errors.length ? 1 : 0);
