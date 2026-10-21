import { loadPlaywright, launchBrowser, serveOutputs, advanceFrames, collectErrors, ROOT } from './_harness.mjs';
import path from 'node:path'; import fs from 'node:fs';
const OUT = path.join(ROOT, 'ref', 'car-views');
fs.mkdirSync(OUT, { recursive: true });
const playwright = await loadPlaywright();
const srv = await serveOutputs();
const b = await launchBrowser(playwright);
const pg = await b.newPage({viewport:{width:760,height:480}});
const errs = collectErrors(pg);
await pg.goto(srv.base + '/car-gallery.html',{waitUntil:'load',timeout:60000});
await pg.waitForFunction(()=>window.__view__,{timeout:30000});
for (const v of ['front','rear','side','front45','rear45','top','bottom']) {
  await pg.evaluate(n=>window.__view__(n), v);
  await advanceFrames(pg, 6);
  await pg.waitForTimeout(100);
  await pg.screenshot({path: path.join(OUT, `${v}.png`)});
  console.log('✓', v);
}
console.log('ERR:', errs.join('\n')||'(none)');
await b.close();
await srv.close();
