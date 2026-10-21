/**
 * 视觉/浏览器测试的共享工具
 *
 * 解决三个硬编码问题:
 *   1. playwright 绝对路径  -> 动态解析(本地 node_modules / 全局 / PLAYWRIGHT_PATH 环境变量)
 *   2. Chrome 绝对路径     -> 环境变量 CHROME_PATH, 否则按平台探测常见安装位置
 *   3. 静态端口 8765        -> 自动选空闲端口, 启动临时 http 服务, 测试结束自动关闭
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const OUTPUTS = path.join(ROOT, 'outputs');
export const REF = path.join(ROOT, 'ref');

/** 解析 playwright —— 优先本地依赖, 其次全局, 最后环境变量 */
export async function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_PATH) candidates.push(process.env.PLAYWRIGHT_PATH);
  candidates.push(
    path.join(ROOT, 'node_modules', 'playwright', 'index.mjs'),
    path.join(ROOT, 'node_modules', 'playwright', 'index.js'),
  );
  // 向上逐级找 node_modules
  let dir = ROOT;
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, 'node_modules', 'playwright', 'index.mjs'));
    candidates.push(path.join(dir, 'node_modules', 'playwright', 'index.js'));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const c of candidates) {
    if (c && existsSync(c)) {
      return await import(pathToFileURL(c).href);
    }
  }
  try {
    return await import('playwright');
  } catch (e) {
    throw new Error(
      '找不到 playwright。请执行 `npm i -D playwright` 或设置 PLAYWRIGHT_PATH 指向其 index.mjs。\n' +
      '尝试过的路径:\n  ' + candidates.filter(Boolean).join('\n  ')
    );
  }
}

/** 探测 Chrome 可执行文件 */
export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const home = process.env.HOME || '';
  const list = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const p of list) if (existsSync(p)) return p;
  return null;
}

export const CHROME_ARGS = ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

/** 启动浏览器(不指定路径则用 Playwright 自带) */
export async function launchBrowser(playwright) {
  const exe = findChrome();
  const opts = { headless: true, args: CHROME_ARGS };
  if (exe) opts.executablePath = exe;
  return playwright.chromium.launch(opts);
}

/** 找一个空闲端口 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2',
};

/** 启动临时静态服务(服务于 outputs/), 返回 { base, close } */
export async function serveOutputs() {
  const port = await freePort();
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(OUTPUTS, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise(r => server.close(r)),
  };
}

/** 推进 n 帧, 等 rAF 真正跑过(headless 下 rAF 启动慢, 必须等) */
export async function advanceFrames(page, n = 20) {
  await page.evaluate((count) => new Promise(res => {
    let i = 0;
    const tick = () => { if (++i >= count) res(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), n);
}

/** 收集控制台/页面错误 */
export function collectErrors(page) {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  return errs;
}
