// 前 100 名详情：把 tools/content/p*.json（人工写的介绍、景点编号＋中文名、出处）和 tools/content/photos.json（Commons 照片）
// 合成 data/details.json 与 tools/names_zh.json。景点英文名和坐标一律从 OSM／Wikidata 原始记录回填，不手写。
// 用法：node tools/content_build.mjs            （联网查询结果缓存在 tools/.cache/refs.json、commons.json）
// 自检（和判卷同一标准）：景点名字对得上、坐标离记录 ≤2 km、离岛 ≤10 km；介绍字数；介绍里的数字必须在维基原文里出现。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const UA = 'PHIslands-build/1.0 (github.com/jyb635050-ai/ph-islands)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, bin) {
  for (let k = 0; k < 10; k++) {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: bin ? '*/*' : 'application/json' }, signal: AbortSignal.timeout(60000) }).catch(() => null);
    if (r && r.status === 404) return null;
    if (r && r.ok) { if (bin) return Buffer.from(await r.arrayBuffer()); const t = await r.text(); try { return JSON.parse(t); } catch (e) { } }
    await sleep(Math.max(r ? +(r.headers.get('retry-after') || 0) * 1000 + 1000 : 0, 3000 * (k + 1)));
  }
  throw new Error('联网失败 ' + url.slice(0, 100));
}
const R = 6371.0088, rad = Math.PI / 180;
const hav = (a, b) => { const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const bboxDist = (p, b) => hav(p, [Math.min(Math.max(p[0], b[0]), b[2]), Math.min(Math.max(p[1], b[1]), b[3])]);

const isl = J('data/islands.json'), byId = new Map(isl.map(i => [i.id, i]));
// 精写范围：原热度前 100 名（已写）＋ 年游客 ≥ 5 万的岛
const C = {}; for (const f of fs.readdirSync(path.join(ROOT, 'tools/content')).filter(f => /^p\d+\.json$/.test(f)).sort()) Object.assign(C, J('tools/content/' + f));
const top100 = isl.filter(i => C[i.id] || i.sig.arrivals >= 50000).sort((a, b) => a.rank - b.rank);
const photos = fs.existsSync(path.join(ROOT, 'tools/content/photos.json')) ? J('tools/content/photos.json') : {};
const raw = J('tools/.cache/content_raw.json');
const problems = [];

// ── 景点编号 → 原始记录 ──
const refsFile = path.join(ROOT, 'tools/.cache/refs.json'), REFS = fs.existsSync(refsFile) ? J('tools/.cache/refs.json') : {};
const allRefs = [...new Set(Object.values(C).flatMap(c => c.spots.map(s => s[0])))];
const qs = allRefs.filter(r => /^Q\d+$/.test(r) && !REFS[r]);
for (let s = 0; s < qs.length; s += 50) {
  const j = await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qs.slice(s, s + 50).join('|')}&props=labels|aliases|claims&languages=en&format=json`);
  for (const [q, e] of Object.entries(j.entities)) { const c = e.claims?.P625?.[0]?.mainsnak?.datavalue?.value; REFS[q] = { names: [e.labels?.en?.value, ...(e.aliases?.en || []).map(a => a.value)].filter(Boolean), pt: c ? [c.longitude, c.latitude] : null }; }
  fs.writeFileSync(refsFile, JSON.stringify(REFS)); await sleep(1500);
}
for (const r of allRefs.filter(r => !/^Q/.test(r) && !REFS[r])) {
  const [t, id] = r.split('/');
  let names = [], pt = null;
  if (t === 'node') { const j = await get(`https://api.openstreetmap.org/api/0.6/node/${id}.json`); const e = j?.elements?.[0]; if (e) { names = [e.tags?.['name:en'], e.tags?.name, e.tags?.alt_name, e.tags?.official_name]; pt = [e.lon, e.lat]; } }
  else { const j = await get(`https://api.openstreetmap.org/api/0.6/${t}/${id}/full.json`); const me = j?.elements?.find(e => e.type === t && String(e.id) === id), ns = (j?.elements || []).filter(e => e.type === 'node'); if (me) { names = [me.tags?.['name:en'], me.tags?.name, me.tags?.alt_name, me.tags?.official_name]; pt = ns.length ? [ns.reduce((s, n) => s + n.lon, 0) / ns.length, ns.reduce((s, n) => s + n.lat, 0) / ns.length] : null; } }
  REFS[r] = { names: names.filter(Boolean), pt }; fs.writeFileSync(refsFile, JSON.stringify(REFS)); await sleep(700);
}

// ── Commons 照片信息 ──
const cmFile = path.join(ROOT, 'tools/.cache/commons.json'), CM = fs.existsSync(cmFile) ? J('tools/.cache/commons.json') : {};
for (const [id, p] of Object.entries(photos)) {
  if (CM[p.commons]) continue;
  const j = await get(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(p.commons)}&prop=imageinfo&iiprop=extmetadata|url&iiurlwidth=960&format=json`);
  const ii = Object.values(j.query?.pages || {})[0]?.imageinfo?.[0];
  CM[p.commons] = ii ? { license: ii.extmetadata?.LicenseShortName?.value || '', author: (ii.extmetadata?.Artist?.value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), thumb: ii.thumburl } : null;
  fs.writeFileSync(cmFile, JSON.stringify(CM)); await sleep(1200);
}

// ── 合成 ──
const nums = t => (String(t).replace(/(\d),(?=\d{3})/g, '$1').match(/\d+(?:\.\d+)?/g) || []);
const out = [], zh = {};
for (const i of top100) {
  const c = C[i.id];
  if (!c) { problems.push(`${i.rank}.${i.id} ${i.name.en}：没写内容`); continue; }
  zh[i.id] = c.zh;
  const spots = [];
  for (const [ref, zhName] of c.spots) {
    const r = REFS[ref];
    if (!r || !r.names.length || !r.pt) { problems.push(`${i.rank}.${i.name.en} 景点 ${ref}「${zhName}」查不到名字或坐标`); continue; }
    const d = bboxDist(r.pt, i.bbox);
    if (d > 9.5) { problems.push(`${i.rank}.${i.name.en} 景点 ${ref}「${r.names[0]}」离岛 ${d.toFixed(1)} km`); continue; }
    spots.push({ name: { zh: zhName, en: r.names[0] }, ref, pt: r.pt.map(v => +v.toFixed(6)) });
  }
  if (spots.length < 3) problems.push(`${i.rank}.${i.name.en} 景点只有 ${spots.length} 个`);
  const zl = c.intro.zh.replace(/\s/g, '').length, ew = c.intro.en.trim().split(/\s+/).length;
  if (zl < 60 || zl > 400) problems.push(`${i.rank}.${i.name.en} 中文介绍 ${zl} 字`);
  if (ew < 40 || ew > 300) problems.push(`${i.rank}.${i.name.en} 英文介绍 ${ew} 词`);
  const srcNums = new Set(nums(raw['x:' + i.wiki]?.text || ''));
  const bad = [...new Set([...nums(c.intro.zh), ...nums(c.intro.en)])].filter(n => +n > 10 && !srcNums.has(n) && !(c.okNums || []).includes(n));
  if (bad.length) problems.push(`${i.rank}.${i.name.en} 介绍里的数字在维基原文里找不到：${bad.join(',')}`);
  const p = photos[i.id], m = p && CM[p.commons];
  let photo = null;
  if (p && m && fs.existsSync(path.join(ROOT, p.file))) photo = { file: p.file, commons: p.commons, author: p.author || m.author, license: m.license };
  else problems.push(`${i.rank}.${i.name.en} 没有照片`);
  out.push({ id: i.id, intro: c.intro, spots, sources: c.src, ...(photo ? { photo } : {}) });
}
fs.writeFileSync(path.join(ROOT, 'data/details.json'), JSON.stringify(out));
fs.writeFileSync(path.join(ROOT, 'tools/names_zh.json'), JSON.stringify(zh, null, 1));
console.log(`详情 ${out.length} 座，景点 ${out.reduce((s, d) => s + d.spots.length, 0)} 个，有照片 ${out.filter(d => d.photo).length} 座`);
console.log(problems.length ? '问题：\n  ' + problems.join('\n  ') : '无问题');
