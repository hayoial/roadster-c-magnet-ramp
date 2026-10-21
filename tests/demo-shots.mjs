/**
 * Demo 模式各机位截图 —— 录屏/展示素材
 *
 * 产出: ref/demo/*.png (7 个机位 + 横幅状态图)
 *
 * 用法: node tests/demo-shots.mjs
 */
import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path';
import fs from 'node:fs';

const OUT = path.join(ROOT, 'ref', 'demo');
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  [1.2, 'a-approach'], [3.0, 'b-climb'], [5.0, 'c-inverted'], [7.0, 'd-jet'],
  [9.2, 'e-roll'], [10.5, 'f-cushion'], [11.9, 'g-land'],
];

const playwright = await loadPlaywright();
const srv = await serveOutputs();
const browser = await launchBrowser(playwright);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = collectErrors(page);

await page.goto(srv.base + '/index.html?demo=1', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__RD__, { timeout: 30000 });
await advanceFrames(page, 20);

for (const [t, name] of SHOTS) {
  await page.evaluate(tt => { window.__RD__.demo.seek(tt); window.__RD__.playing = false; }, t);
  await advanceFrames(page, 45);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const st = await page.evaluate(() => ({
    v: window.__RD__.viewIdx, shot: window.__RD__.demo.shot?.s?.name, note: window.__RD__.demo.shot?.s?.note,
  }));
  console.log(`  ${name.padEnd(12)} t=${String(t).padStart(5)}  机位=${st.v} (${st.shot}) ${st.note}`);
}

console.log('\n错误:', errors.length ? errors.join('|') : '(无)');
await browser.close();
await srv.close();
process.exit(errors.length ? 1 : 0);
