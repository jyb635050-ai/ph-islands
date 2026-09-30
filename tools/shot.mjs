// 调试截图：node tools/shot.mjs [hash] [宽x高] [输出名]   —— 自起服务器，等 __isl.ready，截图到 shots/
import { createRequire } from 'node:module'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire('C:/Users/73405/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [hash = '', size = '1440x900', name = 'dev'] = process.argv.slice(2); const [w, h] = size.split('x').map(Number);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.pbf': 'application/x-protobuf' };
const srv = http.createServer((q, s) => { const u = decodeURIComponent(new URL(q.url, 'http://x').pathname); let f = path.join(ROOT, u.replace(/^\/ph-islands\//, '')); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); }).listen(0);
const port = srv.address().port;
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await (await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700, deviceScaleFactor: w < 700 ? 2 : 1 })).newPage();
const logs = []; p.on('console', m => logs.push(m.type() + ': ' + m.text().slice(0, 200))); p.on('pageerror', e => logs.push('pageerror: ' + e.message));
const t0 = Date.now(); await p.goto(`http://127.0.0.1:${port}/ph-islands/${hash}`);
await p.waitForFunction(() => window.__isl && window.__isl.ready, null, { timeout: 60000 }).catch(e => logs.push('not ready'));
logs.push('ready ms ' + (Date.now() - t0));
if (process.env.EVAL) { const r = await p.evaluate(process.env.EVAL).catch(e => 'ERR ' + e.message); logs.push('eval: ' + JSON.stringify(r).slice(0, 500)); }
await p.waitForTimeout(+(process.env.WAIT || 1500));
fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
await p.screenshot({ path: path.join(ROOT, 'shots', name + '.png') });
console.log(logs.join('\n')); await b.close(); srv.close();
