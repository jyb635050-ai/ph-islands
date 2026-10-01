// 研究用：用真浏览器打开客流出处网页，打印含关键词/数字的原句。node tools/arrivals_probe.mjs urls.json
// urls.json: [{url, needles:["2,077,977", ...]}]
import { createRequire } from 'node:module'; import fs from 'node:fs';
const require = createRequire('C:/Users/73405/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const list = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', locale: 'en-US' });
const out = [];
for (const it of list) {
  const p = await ctx.newPage();
  let txt = '', st = 0;
  try { const r = await p.goto(it.url, { waitUntil: 'domcontentloaded', timeout: 45000 }); st = r ? r.status() : 0; await p.waitForTimeout(2500); txt = await p.evaluate(() => document.body.innerText); } catch (e) { txt = 'ERR ' + e.message; }
  const sents = txt.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  const hits = sents.filter(s => (it.needles || []).some(n => s.includes(n)) || (it.re && new RegExp(it.re, 'i').test(s)));
  console.log(`\n== [${st}] ${it.url} (${txt.length} chars)`);
  for (const h of hits.slice(0, 12)) console.log('  > ' + h.slice(0, 400));
  out.push({ url: it.url, status: st, len: txt.length, hits });
  await p.close();
}
fs.writeFileSync(process.argv[2].replace(/\.json$/, '.out.json'), JSON.stringify(out, null, 1));
await b.close();
