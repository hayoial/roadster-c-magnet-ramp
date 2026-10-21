import { chromium } from '/Users/shuai/node_modules/playwright/index.mjs';
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'ref', 'car-views');
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--enable-unsafe-swiftshader']});
const pg = await b.newPage({viewport:{width:760,height:480}});
const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
pg.on('console',m=>{if(m.type()==='error')errs.push('C:'+m.text());});
await pg.goto('http://localhost:8765/car-gallery.html',{waitUntil:'load',timeout:60000});
await pg.waitForFunction(()=>window.__view__,{timeout:30000});
for (const v of ['front','rear','side','front45','rear45','top','bottom']) {
  await pg.evaluate(n=>window.__view__(n), v);
  await pg.evaluate(()=>new Promise(r=>{let n=0;const t=()=>{if(++n>=6)r();else requestAnimationFrame(t);};requestAnimationFrame(t);}));
  await pg.waitForTimeout(100);
  await pg.screenshot({path: path.join(OUT, `${v}.png`)});
  console.log('✓', v);
}
console.log('ERR:', errs.join('\n')||'(none)');
await b.close();
