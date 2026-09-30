// 前 100 名内容素材：维基百科导语、Wikidata 主图(P18)、岛上带坐标的景点候选（Wikidata）。
// 用法：node tools/content_fetch.mjs   → tools/.cache/content_raw.json（人工写介绍时参考，不直接上站）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'PHIslands-build/1.0 (github.com/jyb635050-ai/ph-islands)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url, opt = {}) {
  for (let k = 0; k < 12; k++) {
    let r; try { r = await fetch(url, { ...opt, headers: { 'user-agent': UA, accept: 'application/json', ...(opt.headers || {}) }, signal: AbortSignal.timeout(90000) }); } catch (e) { await sleep(5000); continue; }
    const t = await r.text(); if (r.ok) { try { return JSON.parse(t); } catch (e) { } }
    await sleep(Math.max(+(r.headers.get('retry-after') || 0) * 1000 + 1000, 3000 * (k + 1)));
  }
  throw new Error('fail ' + url.slice(0, 90));
}
const isl = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/islands.json'), 'utf8')).sort((a, b) => a.rank - b.rank).slice(0, 100);
const out = fs.existsSync(path.join(ROOT, 'tools/.cache/content_raw.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/.cache/content_raw.json'), 'utf8')) : {};
// 1 维基导语
const titles = isl.map(i => i.wiki).filter(Boolean);
for (let s = 0; s < titles.length; s += 15) {
  const ts = titles.slice(s, s + 15).filter(t => !out['x:' + t]);
  if (!ts.length) continue;
  const j = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&exlimit=20&redirects=1&format=json&titles=${encodeURIComponent(ts.join('|'))}`);
  const redir = {}; for (const r of j.query.redirects || []) redir[r.to] = r.from; for (const r of j.query.normalized || []) redir[r.to] = redir[r.to] || r.from;
  for (const p of Object.values(j.query.pages)) { const from = redir[p.title] || p.title; out['x:' + from] = { page: p.title, text: (p.extract || '').slice(0, 2500) }; }
  await sleep(1500);
}
// 2 主图 P18
const wds = isl.map(i => i.wd).filter(Boolean);
for (let s = 0; s < wds.length; s += 50) {
  const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wds.slice(s, s + 50).join('|')}&props=claims&format=json`);
  for (const [q, e] of Object.entries(j.entities)) out['p18:' + q] = (e.claims?.P18 || []).map(c => c.mainsnak?.datavalue?.value).filter(Boolean);
  await sleep(1500);
}
// 3 景点候选：菲律宾境内这些类别的带坐标条目
if (!out.spots) {
  const CLS = ['Q570116', 'Q40080', 'Q8502', 'Q8072', 'Q35509', 'Q34038', 'Q39715', 'Q16970', 'Q57821', 'Q1785071', 'Q46169', 'Q473972', 'Q23397', 'Q177380', 'Q33506', 'Q184358', 'Q39594', 'Q2319498', 'Q4989906', 'Q54050', 'Q185113', 'Q1440300', 'Q22698', 'Q124714', 'Q839954', 'Q5003624', 'Q179700', 'Q2977', 'Q1068842', 'Q12518', 'Q44782', 'Q15324', 'Q1377575', 'Q20719696', 'Q2385804', 'Q43501', 'Q179049', 'Q1497364', 'Q160091', 'Q2065736', 'Q7075', 'Q1195942', 'Q15284', 'Q24398318', 'Q27686', 'Q1437459', 'Q23442', 'Q1076486', 'Q2143825', 'Q3918', 'Q41176', 'Q12280', 'Q1497375', 'Q210272', 'Q7930989', 'Q1021645', 'Q17350442', 'Q15893266', 'Q55488', 'Q1244442', 'Q2175765', 'Q1760610'];
  const q = `SELECT ?i ?c ?coord ?en ?zh ?sl WHERE { VALUES ?c { ${CLS.map(c => 'wd:' + c).join(' ')} } ?i wdt:P31 ?c; wdt:P17 wd:Q928; wdt:P625 ?coord; wikibase:sitelinks ?sl. OPTIONAL { ?i rdfs:label ?en FILTER(LANG(?en)="en") } OPTIONAL { ?i rdfs:label ?zh FILTER(LANG(?zh)="zh") } }`;
  const j = await getJSON('https://query.wikidata.org/sparql', { method: 'POST', headers: { accept: 'application/sparql-results+json', 'content-type': 'application/x-www-form-urlencoded' }, body: 'query=' + encodeURIComponent(q) });
  const m = new Map();
  for (const b of j.results.bindings) { const id = b.i.value.split('/').pop(); const c = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value); if (!c) continue; const o = m.get(id) || { q: id, pt: [+c[1], +c[2]], en: b.en?.value || null, zh: b.zh?.value || null, sl: +b.sl.value, cls: [] }; o.cls.push(b.c.value.split('/').pop()); m.set(id, o); }
  out.spots = [...m.values()];
}
fs.writeFileSync(path.join(ROOT, 'tools/.cache/content_raw.json'), JSON.stringify(out));
console.log('导语', Object.keys(out).filter(k => k.startsWith('x:')).length, '主图', Object.keys(out).filter(k => k.startsWith('p18:') && out[k].length).length, '景点候选', out.spots.length);
