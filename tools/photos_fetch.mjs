// 照片候选：每座前 100 名岛取 Wikidata 主图(P18)＋Commons 搜索结果，只留许可合格的，拼成联络表供人工目检。
// 用法：node tools/photos_fetch.mjs sheets        → tools/.cache/sheets/sheet-N.png（每张 10 座岛 × 4 候选）＋ photo_cands.json
//       node tools/photos_fetch.mjs pick          → 按 tools/content/photo_pick.json（{id: 候选序号}）下载 960 宽、转 webp 到 assets/photos/，写 tools/content/photos.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire('C:/Users/73405/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/package.json');
const sharp = require('sharp');
const J = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const UA = 'PHIslands-build/1.0 (github.com/jyb635050-ai/ph-islands)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, bin) {
  for (let k = 0; k < 10; k++) {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) }).catch(() => null);
    if (r && r.status === 404) return null;
    if (r && r.ok) { if (bin) return Buffer.from(await r.arrayBuffer()); const t = await r.text(); try { return JSON.parse(t); } catch (e) { } }
    await sleep(Math.max(r ? +(r.headers.get('retry-after') || 0) * 1000 + 1000 : 0, 3000 * (k + 1)));
  }
  throw new Error('联网失败 ' + url.slice(0, 100));
}
const OKLIC = /^(cc0|public domain|pd\b|cc[ -]by(-sa)?(\s|$|-?\d))/i;
const BAD = /map|locator|location|flag|seal|logo|coat of arms|\.svg|\.pdf|\.tif|diagram|chart|stamp|document|census|sketch|plan of|nautical/i;
const isl = J('data/islands.json').sort((a, b) => a.rank - b.rank).slice(0, 100);
const raw = J('tools/.cache/content_raw.json');
const CF = path.join(ROOT, 'tools/.cache/photo_cands.json');
const mode = process.argv[2];

async function info(titles) {
  const j = await get(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join('|'))}&prop=imageinfo&iiprop=extmetadata|url|size&iiurlwidth=320&format=json`);
  return Object.values(j?.query?.pages || {}).map(p => { const ii = p.imageinfo?.[0]; const m = ii?.extmetadata || {}; return ii && { title: p.title, lic: m.LicenseShortName?.value || '', author: (m.Artist?.value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), w: ii.width, h: ii.height, thumb: ii.thumburl }; }).filter(Boolean);
}

if (mode === 'sheets') {
  const cands = fs.existsSync(CF) ? JSON.parse(fs.readFileSync(CF, 'utf8')) : {};
  for (const i of isl) {
    if (cands[i.id]) continue;
    const p18 = (raw['p18:' + i.wd] || []).map(f => 'File:' + f);
    const q = (raw['x:' + i.wiki]?.page || i.name.en || '').replace(/\s*\(.*\)$/, '');
    const s = await get(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q + (/(island|isla)/i.test(q) ? '' : ' island') + ' Philippines filetype:bitmap')}&srnamespace=6&srlimit=12&format=json`);
    const found = (s?.query?.search || []).map(x => x.title);
    const titles = [...new Set([...p18, ...found])].filter(t => !BAD.test(t)).slice(0, 12);
    const inf = titles.length ? await info(titles) : [];
    const ok = titles.map(t => inf.find(x => x.title === t.replace(/_/g, ' '))).filter(x => x && OKLIC.test(x.lic.trim()) && x.w >= 800 && x.author).slice(0, 4);
    cands[i.id] = ok; fs.writeFileSync(CF, JSON.stringify(cands));
    console.log(i.rank, i.name.en, ok.length);
    await sleep(1200);
  }
  // 联络表
  const dir = path.join(ROOT, 'tools/.cache/sheets'); fs.mkdirSync(dir, { recursive: true });
  const W = 300, H = 200, per = 10;
  for (let s = 0; s < isl.length; s += per) {
    const rows = isl.slice(s, s + per), comps = [];
    for (let r = 0; r < rows.length; r++) {
      const i = rows[r];
      comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="220" height="${H}"><rect width="220" height="${H}" fill="#fff"/><text x="6" y="30" font-size="22" font-family="Arial" font-weight="bold">${i.rank}. ${i.name.en.replace(/&/g, '&amp;')}</text><text x="6" y="58" font-size="16" font-family="Arial">${i.prov}</text></svg>`), left: 0, top: r * H });
      const cs = cands[i.id] || [];
      for (let k = 0; k < cs.length; k++) {
        let b = await get(cs[k].thumb, true).catch(() => null);
        if (!b) continue;
        b = await sharp(b).resize(W - 6, H - 26, { fit: 'cover' }).png().toBuffer();
        comps.push({ input: b, left: 220 + k * W, top: r * H });
        comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W - 6}" height="24"><rect width="${W - 6}" height="24" fill="#000"/><text x="4" y="17" font-size="15" fill="#ff0" font-family="Arial">[${k}] ${cs[k].title.slice(5, 40).replace(/&/g, '&amp;').replace(/</g, '')}</text></svg>`), left: 220 + k * W, top: r * H + H - 26 });
        await sleep(300);
      }
    }
    await sharp({ create: { width: 220 + 4 * W, height: rows.length * H, channels: 3, background: '#ddd' } }).composite(comps).png().toFile(path.join(dir, `sheet-${s / per + 1}.png`));
    console.log('sheet', s / per + 1);
  }
}

if (mode === 'pick') {
  const cands = JSON.parse(fs.readFileSync(CF, 'utf8')), pick = J('tools/content/photo_pick.json'), out = {};
  fs.mkdirSync(path.join(ROOT, 'assets/photos'), { recursive: true });
  for (const [id, k] of Object.entries(pick)) {
    const c = cands[id]?.[k]; if (!c) { console.log('没有候选', id, k); continue; }
    const j = await get(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(c.title)}&prop=imageinfo&iiprop=url&iiurlwidth=960&format=json`);
    const url = Object.values(j.query.pages)[0].imageinfo[0].thumburl;
    const b = await get(url, true);
    let q = 80, w = await sharp(b).resize({ width: 960, withoutEnlargement: true }).webp({ quality: q }).toBuffer();
    while (w.length > 280 * 1024 && q > 40) { q -= 10; w = await sharp(b).resize({ width: 960, withoutEnlargement: true }).webp({ quality: q }).toBuffer(); }
    const file = `assets/photos/${id}.webp`; fs.writeFileSync(path.join(ROOT, file), w);
    out[id] = { file, commons: c.title, author: c.author };
    console.log(id, c.title, Math.round(w.length / 1024) + 'KB');
    await sleep(1200);
  }
  fs.writeFileSync(path.join(ROOT, 'tools/content/photos.json'), JSON.stringify(out, null, 1));
}

if (mode === "retry") {
  // 用指定关键词重搜：tools/content/photo_retry.json {id: "关键词"}，结果写入候选并出 sheet-retry.png
  const cands = JSON.parse(fs.readFileSync(CF, "utf8")), Q = J("tools/content/photo_retry.json");
  const rows = Object.entries(Q), W = 300, H = 200, comps = [];
  for (let r = 0; r < rows.length; r++) {
    const [id, q] = rows[r];
    const s = await get(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q + " filetype:bitmap")}&srnamespace=6&srlimit=20&format=json`);
    const titles = (s?.query?.search || []).map(x => x.title).filter(t => !BAD.test(t)).slice(0, 16);
    const inf = titles.length ? await info(titles) : [];
    const ok = titles.map(t => inf.find(x => x.title === t)).filter(x => x && OKLIC.test(x.lic.trim()) && x.w >= 800 && x.author).slice(0, 4);
    cands[id] = ok; fs.writeFileSync(CF, JSON.stringify(cands));
    comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="220" height="${H}"><rect width="220" height="${H}" fill="#fff"/><text x="6" y="30" font-size="20" font-family="Arial" font-weight="bold">${id}</text><text x="6" y="58" font-size="15" font-family="Arial">${q.replace(/&/g, "&amp;")}</text></svg>`), left: 0, top: r * H });
    for (let k = 0; k < ok.length; k++) {
      let b = await get(ok[k].thumb, true).catch(() => null); if (!b) continue;
      b = await sharp(b).resize(W - 6, H - 26, { fit: "cover" }).png().toBuffer();
      comps.push({ input: b, left: 220 + k * W, top: r * H });
      comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W - 6}" height="24"><rect width="${W - 6}" height="24" fill="#000"/><text x="4" y="17" font-size="15" fill="#ff0" font-family="Arial">[${k}] ${ok[k].title.slice(5, 40).replace(/&/g, "&amp;").replace(/</g, "")}</text></svg>`), left: 220 + k * W, top: r * H + H - 26 });
      await sleep(300);
    }
    console.log(id, q, ok.length); await sleep(1200);
  }
  await sharp({ create: { width: 220 + 4 * W, height: rows.length * H, channels: 3, background: "#ddd" } }).composite(comps).resize({ width: 1400 }).jpeg({ quality: 80 }).toFile(path.join(ROOT, "tools/.cache/sheets/retry.jpg"));
}
