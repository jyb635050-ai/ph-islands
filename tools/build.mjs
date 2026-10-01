// 数据管线：从 tools/cache 生成 data/ 下全部数据。
// 用法（在 D:\blender\PHIslands 下）：node tools/build.mjs
//   各阶段结果缓存在 tools/.cache/（删掉对应文件即重做）；联网只有 Wikidata 与 Wikimedia 访问量两步，被 429 限流会按 retry-after 等。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools/cache'), TMP = path.join(ROOT, 'tools/.cache'), DATA = path.join(ROOT, 'data');
fs.mkdirSync(TMP, { recursive: true }); fs.mkdirSync(DATA, { recursive: true });
const require = createRequire(path.join(ROOT, 'tools/package.json'));
const UA = 'PHIslands-build/1.0 (github.com/jyb635050-ai/ph-islands)';
const PERIOD = ['2025-09', '2026-08'];
const F = { w: { views: 0.3, pois: 0.1, density: 0.45, links: 0.15 }, cap: { views: 250000, pois: 3000, density: 60, links: 80 }, a0: 1 };
const FA = { cap: 10000000, base: 50, span: 50, scale: 0.499 }; // 客流档与热度垫底档
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = 6371.0088, rad = Math.PI / 180;
const readJ = f => JSON.parse(fs.readFileSync(f, 'utf8'));

// ───── 几何工具 ─────
function ringArea(r) { let a = 0; for (let i = 0; i < r.length - 1; i++) { const [x1, y1] = r[i], [x2, y2] = r[i + 1]; a += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad)); } return Math.abs(a * R * R / 2); }
const polyArea = rings => ringArea(rings[0]) - rings.slice(1).reduce((s, h) => s + ringArea(h), 0);
function pipRing(p, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }
const inRings = (p, rings) => pipRing(p, rings[0]) && !rings.slice(1).some(h => pipRing(p, h));
function hav(a, b) { const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
const bboxOf = r => { let b = [999, 999, -999, -999]; for (const [x, y] of r) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; } return b; };
// Douglas-Peucker：闭合环先在离起点最远处拆成两段再分别简化，否则整环会塌
function dp(pts, tol) {
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]], t2 = tol * tol;
  while (st.length) { const [a, b] = st.pop(); let mx = -1, mi = -1; const [x1, y1] = pts[a], [x2, y2] = pts[b]; const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) { const [x, y] = pts[i]; let t = L ? ((x - x1) * dx + (y - y1) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const d = (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2; if (d > mx) { mx = d; mi = i; } }
    if (mx > t2) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
  return pts.filter((_, i) => keep[i]);
}
function simplifyRing(r, tol) {
  if (r.length < 8 || !tol) return r;
  let far = 0, fd = -1; for (let i = 1; i < r.length - 1; i++) { const d = (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const A = dp(r.slice(0, far + 1), tol), B = dp(r.slice(far), tol), out = [...A, ...B.slice(1)];
  return out.length >= 4 ? out : r;
}
// polylabel（离边界最远的内部点），用于 pt
function polylabel(rings, precision) {
  const b = bboxOf(rings[0]), w = b[2] - b[0], h = b[3] - b[1], cs = Math.min(w, h); if (cs === 0) return [b[0], b[1]];
  const segDist = (px, py, a, c) => { let x = a[0], y = a[1], dx = c[0] - x, dy = c[1] - y; if (dx || dy) { const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy); if (t > 1) { x = c[0]; y = c[1]; } else if (t > 0) { x += dx * t; y += dy * t; } } dx = px - x; dy = py - y; return dx * dx + dy * dy; };
  const dist = (x, y) => { let inside = false, m = Infinity; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], c = r[j]; if ((a[1] > y) !== (c[1] > y) && x < (c[0] - a[0]) * (y - a[1]) / (c[1] - a[1]) + a[0]) inside = !inside; m = Math.min(m, segDist(x, y, a, c)); } return (inside ? 1 : -1) * Math.sqrt(m); };
  const cell = (x, y, hh) => { const d = dist(x, y); return { x, y, h: hh, d, max: d + hh * Math.SQRT2 }; };
  const q = []; let hc = cs / 2; for (let x = b[0]; x < b[2]; x += cs) for (let y = b[1]; y < b[3]; y += cs) q.push(cell(x + hc, y + hc, hc));
  let best = cell(b[0] + w / 2, b[1] + h / 2, 0); let n = 0;
  while (q.length && n++ < 20000) { q.sort((a, c) => a.max - c.max); const c = q.pop(); if (c.d > best.d) best = c; if (c.max - best.d <= precision) continue; hc = c.h / 2; q.push(cell(c.x - hc, c.y - hc, hc), cell(c.x + hc, c.y - hc, hc), cell(c.x - hc, c.y + hc, hc), cell(c.x + hc, c.y + hc, hc)); }
  return [best.x, best.y];
}

// ───── A：从 shp 抽出菲律宾范围的陆地块 ─────
const BB = [116.0, 4.4, 127.0, 21.4];
function extract() {
  const f = path.join(TMP, 'lp_bbox.json'); if (fs.existsSync(f)) return readJ(f);
  log('A 读 land_polygons.shp');
  const fd = fs.openSync(path.join(CACHE, 'land_polygons.shp'), 'r'), size = fs.fstatSync(fd).size, hdr = Buffer.alloc(52), out = [];
  let pos = 100;
  while (pos < size) {
    fs.readSync(fd, hdr, 0, 52, pos); const len = hdr.readInt32BE(4) * 2;
    if (hdr.readInt32LE(8) === 5) {
      const x0 = hdr.readDoubleLE(12), y0 = hdr.readDoubleLE(20), x1 = hdr.readDoubleLE(28), y1 = hdr.readDoubleLE(36);
      if (x1 >= BB[0] && x0 <= BB[2] && y1 >= BB[1] && y0 <= BB[3] && x1 - x0 < 20) {
        const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, pos + 8);
        const np = buf.readInt32LE(36), npt = buf.readInt32LE(40), parts = []; for (let i = 0; i < np; i++) parts.push(buf.readInt32LE(44 + 4 * i));
        const p0 = 44 + 4 * np, rings = [];
        for (let i = 0; i < np; i++) { const a = parts[i], e = i + 1 < np ? parts[i + 1] : npt, r = []; for (let k = a; k < e; k++) r.push([+buf.readDoubleLE(p0 + 16 * k).toFixed(7), +buf.readDoubleLE(p0 + 16 * k + 8).toFixed(7)]); rings.push(r); }
        out.push({ bbox: [x0, y0, x1, y1], rings });
      }
    }
    pos += 8 + len;
  }
  fs.writeFileSync(f, JSON.stringify(out)); log('A 范围内', out.length, '块'); return out;
}

// ───── B：归属国家（在国界内→该国；否则离哪国国界最近），排除争议海域 ─────
function loadCountry(file) {
  const g = readJ(path.join(CACHE, file)).features[0].geometry, mp = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  const parts = mp.map(p => ({ p, b: bboxOf(p[0]) })).filter(o => o.b[2] >= 115 && o.b[0] <= 128 && o.b[3] >= 3 && o.b[1] <= 22.5);
  const grid = new Map(); for (const { p } of parts) for (const r of p) for (const [x, y] of r) { const k = Math.floor(x * 10) + ',' + Math.floor(y * 10); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, y]); }
  return { parts, grid };
}
function countryDist(C, pt) {
  for (const { p, b } of C.parts) if (pt[0] >= b[0] && pt[0] <= b[2] && pt[1] >= b[1] && pt[1] <= b[3] && inRings(pt, p)) return 0;
  const gx = Math.floor(pt[0] * 10), gy = Math.floor(pt[1] * 10); let best = Infinity;
  for (let rr = 0; rr <= 30; rr++) {
    for (let dx = -rr; dx <= rr; dx++) for (let dy = -rr; dy <= rr; dy++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue; const a = C.grid.get((gx + dx) + ',' + (gy + dy)); if (a) for (const q of a) best = Math.min(best, hav(pt, q)); }
    if (best < Infinity && best < (rr - 1) * 10 * 1.0) break;
  }
  return best;
}

// ───── 联网工具 ─────
async function getJSON(url, opt = {}) {
  for (let k = 0; k < 12; k++) {
    let r; try { r = await fetch(url, { ...opt, headers: { 'user-agent': UA, accept: 'application/json', ...(opt.headers || {}) }, signal: AbortSignal.timeout(60000) }); } catch (e) { await sleep(5000); continue; }
    if (r.status === 404) return null;
    const t = await r.text();
    if (r.ok) { try { return JSON.parse(t); } catch (e) { } }
    const ra = +(r.headers.get('retry-after') || 0); await sleep(Math.max(ra * 1000 + 1000, 3000 * (k + 1)));
  }
  throw new Error('联网失败 ' + url.slice(0, 100));
}

async function main() {
  const lp = extract();
  log('B 归属国家、面积、内部点');
  const C = { PHL: loadCountry('geoBoundaries-PHL-ADM0.geojson'), MYS: loadCountry('geoBoundaries-MYS-ADM0.geojson'), IDN: loadCountry('geoBoundaries-IDN-ADM0.geojson') };
  let isl = [];
  lp.forEach((o, k) => {
    const coarse = o.rings.map(r => r.length > 5000 ? simplifyRing(r, 0.002) : r);
    let pt = polylabel(coarse, Math.max(1e-6, Math.min(o.bbox[2] - o.bbox[0], o.bbox[3] - o.bbox[1]) / 200));
    if (!inRings(pt, o.rings)) pt = polylabel(o.rings, 1e-6);
    if (pt[0] < BB[0] || pt[0] > BB[2] || pt[1] < BB[1] || pt[1] > BB[3]) return;
    if (pt[0] < 117 && pt[1] > 8.5) return; // 东沙岛、南海争议岛礁
    const d = { PHL: countryDist(C.PHL, pt), MYS: countryDist(C.MYS, pt), IDN: countryDist(C.IDN, pt) };
    if (!(d.PHL <= d.MYS && d.PHL <= d.IDN) || !isFinite(d.PHL)) return;
    isl.push({ k, id: 'i' + k, rings: o.rings, bbox: o.bbox, pt, area: +polyArea(o.rings).toFixed(7) }); // 取整后的面积贯穿全程（打分、排名、输出一致）
  });
  log('B 菲律宾', isl.length, '块，面积', Math.round(isl.reduce((s, i) => s + i.area, 0)));

  // 网格索引
  const grid = new Map();
  for (const i of isl) for (let x = Math.floor(i.bbox[0] * 4); x <= Math.floor(i.bbox[2] * 4); x++) for (let y = Math.floor(i.bbox[1] * 4); y <= Math.floor(i.bbox[3] * 4); y++) { const key = x + ',' + y; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(i); }
  for (const g of grid.values()) g.sort((a, b) => a.area - b.area);
  const pipRingsCache = new Map();
  const pipRings = i => { if (!pipRingsCache.has(i.k)) { const nv = i.rings.reduce((s, r) => s + r.length, 0); pipRingsCache.set(i.k, nv > 20000 ? i.rings.map(r => simplifyRing(r, 0.0003)) : i.rings); } return pipRingsCache.get(i.k); };
  const islandAt = p => { for (const i of grid.get(Math.floor(p[0] * 4) + ',' + Math.floor(p[1] * 4)) || []) if (p[0] >= i.bbox[0] && p[0] <= i.bbox[2] && p[1] >= i.bbox[1] && p[1] <= i.bbox[3] && inRings(p, pipRings(i))) return i; return null; };

  // ───── C：岛名（OSM place=island|islet：点→所在块；线/面→外框最吻合的块）─────
  log('C 岛名匹配');
  const places = readJ(path.join(TMP, 'osm_places_bb.json')).elements.filter(e => e.tags?.name);
  const cand = new Map();
  const put = (i, e, q) => { const c = cand.get(i.k); const score = (e.tags.wikidata ? 2 : 0) + q + (e.tags.place === 'island' ? 0.1 : 0); if (!c || score > c.score) cand.set(i.k, { e, score }); };
  for (const e of places) {
    if (e.type === 'node') { const i = islandAt([e.lon, e.lat]); if (i) put(i, e, 0.5); continue; }
    if (!e.bounds) continue;
    const fb = [e.bounds.minlon, e.bounds.minlat, e.bounds.maxlon, e.bounds.maxlat], fa = (fb[2] - fb[0]) * (fb[3] - fb[1]);
    let best = null, bi = 0;
    const seen = new Set();
    for (let x = Math.floor(fb[0] * 4); x <= Math.floor(fb[2] * 4); x++) for (let y = Math.floor(fb[1] * 4); y <= Math.floor(fb[3] * 4); y++) for (const i of grid.get(x + ',' + y) || []) {
      if (seen.has(i.k)) continue; seen.add(i.k);
      const ix = Math.max(0, Math.min(fb[2], i.bbox[2]) - Math.max(fb[0], i.bbox[0])) * Math.max(0, Math.min(fb[3], i.bbox[3]) - Math.max(fb[1], i.bbox[1]));
      const u = fa + (i.bbox[2] - i.bbox[0]) * (i.bbox[3] - i.bbox[1]) - ix, iou = u > 0 ? ix / u : 0;
      if (iou > bi) { bi = iou; best = i; }
    }
    if (best && bi >= 0.5) put(best, e, bi);
  }
  for (const i of isl) { const c = cand.get(i.k); i.name = { en: c ? c.e.tags['name:en'] || c.e.tags.name : null, zh: null }; i.osm = c ? `${c.e.type}/${c.e.id}` : null; i.wdOsm = c && /^Q\d+$/.test(c.e.tags.wikidata || '') ? c.e.tags.wikidata : null; }
  log('C 有名字', isl.filter(i => i.name.en).length, '有 OSM wikidata', isl.filter(i => i.wdOsm).length);

  // ───── D：Wikidata（菲律宾的岛全表＋OSM 给的 wd）─────
  const wdf = path.join(TMP, 'wikidata.json');
  let W = fs.existsSync(wdf) ? readJ(wdf) : null;
  if (!W) {
    log('D 查 Wikidata 菲律宾岛全表');
    const q = `SELECT ?i ?coord WHERE { ?i wdt:P31/wdt:P279* wd:Q23442; wdt:P17 wd:Q928. OPTIONAL { ?i wdt:P625 ?coord } }`;
    const j = await getJSON('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { accept: 'application/sparql-results+json' } });
    const island = {}; for (const b of j.results.bindings) { const id = b.i.value.split('/').pop(); const m = b.coord && /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value); if (!island[id]) island[id] = m ? [+m[1], +m[2]] : null; }
    W = { island, ent: {} }; fs.writeFileSync(wdf, JSON.stringify(W));
  }
  // OSM 给的 wd 不是岛（比如挂成了省、镇）→ 查它是不是岛
  const needIsle = [...new Set(isl.map(i => i.wdOsm).filter(q => q && !(q in W.island) && !(W.notIsland || []).includes(q)))];
  if (needIsle.length) {
    log('D 核对', needIsle.length, '个 OSM wd 是否为岛');
    W.notIsland = W.notIsland || [];
    for (let s = 0; s < needIsle.length; s += 150) {
      const vals = needIsle.slice(s, s + 150).map(x => 'wd:' + x).join(' ');
      const j = await getJSON('https://query.wikidata.org/sparql', { method: 'POST', headers: { accept: 'application/sparql-results+json', 'content-type': 'application/x-www-form-urlencoded' }, body: 'query=' + encodeURIComponent(`SELECT ?i WHERE { VALUES ?i { ${vals} } ?i wdt:P31/wdt:P279* wd:Q23442 . }`) });
      const ok = new Set(j.results.bindings.map(b => b.i.value.split('/').pop()));
      for (const q of needIsle.slice(s, s + 150)) if (ok.has(q)) W.island[q] = null; else W.notIsland.push(q);
      await sleep(1500);
    }
    fs.writeFileSync(wdf, JSON.stringify(W));
  }
  for (const i of isl) i.wd = i.wdOsm && i.wdOsm in W.island ? i.wdOsm : null;
  // Wikidata 岛坐标落在哪块上：该块还没有 wd 就补上
  const used = new Set(isl.map(i => i.wd).filter(Boolean));
  for (const [q, c] of Object.entries(W.island)) { if (!c || used.has(q)) continue; const i = islandAt(c); if (i && !i.wd) { i.wd = q; used.add(q); } }
  // 同一 wd 只给一块（面积大的）
  const byWd = new Map(); for (const i of isl) if (i.wd) { const o = byWd.get(i.wd); if (!o || i.area > o.area) byWd.set(i.wd, i); }
  for (const i of isl) if (i.wd && byWd.get(i.wd) !== i) i.wd = null;
  const need = [...new Set(isl.map(i => i.wd).filter(q => q && !W.ent[q]))];
  if (need.length) log('D 取', need.length, '个条目的 sitelinks／标签');
  for (let s = 0; s < need.length; s += 50) {
    const ids = need.slice(s, s + 50);
    const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=sitelinks|labels&languages=en|zh|zh-hans|zh-cn|zh-hant|zh-tw&format=json`);
    for (const [q, e] of Object.entries(j.entities || {})) { const L = e.labels || {}; W.ent[q] = { links: Object.keys(e.sitelinks || {}).length, en: e.sitelinks?.enwiki?.title || null, label: L.en?.value || null, zh: L['zh-hans']?.value || L['zh-cn']?.value || L.zh?.value || null }; }
    fs.writeFileSync(wdf, JSON.stringify(W)); await sleep(1500);
  }
  for (const i of isl) { const e = i.wd && W.ent[i.wd]; i.wiki = e?.en || null; i.links = e?.links || 0; if (!i.name.en && e?.label) i.name.en = e.label; }
  log('D wd', isl.filter(i => i.wd).length, '有英文维基', isl.filter(i => i.wiki).length);

  // ───── E：访问量 ─────
  const pvf = path.join(TMP, `pv_${PERIOD[0]}_${PERIOD[1]}.json`), PV = fs.existsSync(pvf) ? readJ(pvf) : {};
  const end = new Date(Date.UTC(+PERIOD[1].slice(0, 4), +PERIOD[1].slice(5, 7), 0)).toISOString().slice(0, 10).replace(/-/g, '');
  const titles = [...new Set(isl.map(i => i.wiki).filter(t => t && !(t in PV)))];
  if (titles.length) log('E 取访问量', titles.length, '条（限流时会慢）');
  for (const t of titles) {
    const j = await getJSON(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(t.replace(/ /g, '_'))}/monthly/${PERIOD[0].replace('-', '')}0100/${end}00`);
    PV[t] = j ? j.items.reduce((s, x) => s + x.views, 0) : 0; fs.writeFileSync(pvf, JSON.stringify(PV)); await sleep(1100);
  }
  for (const i of isl) i.views = i.wiki ? PV[i.wiki] || 0 : 0;

  // ───── F：旅游点 ─────
  log('F 旅游点落岛');
  const pois = readJ(path.join(CACHE, 'osm-tourism-pois-2026-09-29.json')).elements;
  const OKT = /^(hotel|guest_house|resort|hostel|motel|apartment|camp_site|attraction|viewpoint|museum)$/;
  const cnt = new Map();
  for (const e of pois) {
    const t = e.tags || {}; if (!(OKT.test(t.tourism || '') || t.leisure === 'beach_resort' || t.amenity === 'dive_centre')) continue;
    const p = e.center ? [e.center.lon, e.center.lat] : [e.lon, e.lat]; if (p[0] == null) continue;
    const i = islandAt(p); if (i) cnt.set(i.k, (cnt.get(i.k) || 0) + 1);
  }
  for (const i of isl) i.pois = cnt.get(i.k) || 0;

  // ───── G：省 ─────
  log('G 省');
  const provs = readJ(path.join(CACHE, 'geoBoundaries-PHL-ADM2_simplified.geojson')).features.map(f => { const g = f.geometry; const ps = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; return { n: f.properties.shapeName, ps, b: bboxOf(ps.flatMap(p => p[0])) }; });
  const verts = provs.flatMap(p => p.ps.flatMap(pl => pl[0].map(v => [v[0], v[1], p.n])));
  for (const i of isl) {
    const pt = i.pt; let n = null;
    for (const p of provs) if (pt[0] >= p.b[0] && pt[0] <= p.b[2] && pt[1] >= p.b[1] && pt[1] <= p.b[3] && p.ps.some(pl => inRings(pt, pl))) { n = p.n; break; }
    if (!n) { let bd = Infinity; for (const v of verts) { const d = (v[0] - pt[0]) ** 2 * Math.cos(pt[1] * rad) ** 2 + (v[1] - pt[1]) ** 2; if (d < bd) { bd = d; n = v[2]; } } }
    i.prov = n;
  }

  // ───── K：官方年客流分摊到岛（tools/arrivals/records.json）─────
  // 每个住宿设施（酒店/民宿/度假村…）归到包含它的「最具体」统计范围（岛 < 市镇 < 省 < 大区）；
  // 每条记录的剩余数（官方数 − 它包含的子记录）按该范围内各岛的住宿设施数分摊；「岛」级记录整数直接给该岛。
  log('K 客流分摊');
  const REC = readJ(path.join(ROOT, 'tools/arrivals/records.json'));
  const LV = { island: 0, city: 1, province: 2, region: 3 };
  const relGeom = readJ(path.join(TMP, 'adm_geom.json')).elements;
  const relRings = id => { // 把 outer 成员线首尾拼成环
    const r = relGeom.find(e => e.id === id); const segs = r.members.filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry).map(m => m.geometry.map(g => [g.lon, g.lat]));
    const rings = []; let pool = segs.slice();
    while (pool.length) { let ring = pool.shift(); let grown = true; while (grown && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) { grown = false; for (let k = 0; k < pool.length; k++) { const s = pool[k], e = ring[ring.length - 1]; if (s[0][0] === e[0] && s[0][1] === e[1]) { ring = ring.concat(s.slice(1)); } else if (s[s.length - 1][0] === e[0] && s[s.length - 1][1] === e[1]) { ring = ring.concat(s.slice(0, -1).reverse()); } else continue; pool.splice(k, 1); grown = true; break; } } rings.push(ring); }
    return rings;
  };
  const provByName = new Map(provs.map(p => [p.n, p]));
  for (const r of REC) {
    if (r.area.island) r.test = p => { const i = islandAt(p); return !!i && i.id === r.area.island; };
    else if (r.area.osmRel) { const rs = relRings(r.area.osmRel); r.test = p => rs.some(ring => pipRing(p, ring)); }
    else { const ps = r.area.provinces.map(n => { const q = provByName.get(n); if (!q) throw new Error('省名不对：' + n); return q; }); r.test = p => ps.some(q => p[0] >= q.b[0] && p[0] <= q.b[2] && p[1] >= q.b[1] && p[1] <= q.b[3] && q.ps.some(pl => inRings(p, pl))); }
  }
  const ordered = REC.slice().sort((a, b) => LV[a.kind] - LV[b.kind]);
  const ACC = /^(hotel|guest_house|resort|hostel|motel|apartment|camp_site)$/;
  const own = new Map(REC.map(r => [r.id, new Map()]));
  for (const e of pois) {
    const t = e.tags || {}; if (!(ACC.test(t.tourism || '') || t.leisure === 'beach_resort')) continue;
    const p = e.center ? [e.center.lon, e.center.lat] : [e.lon, e.lat]; if (p[0] == null) continue;
    const i = islandAt(p); if (!i) continue;
    const r = ordered.find(r => r.test(p)); if (!r) continue;
    const m = own.get(r.id); m.set(i.id, (m.get(i.id) || 0) + 1);
  }
  const arr = new Map(); const byIdI = new Map(isl.map(i => [i.id, i]));
  const add = (id, v, r) => { const o = arr.get(id) || { v: 0, recs: [], official: false }; o.v += v; if (!o.recs.includes(r.id)) o.recs.push(r.id); if (r.kind === 'island') o.official = true; arr.set(id, o); };
  for (const r of REC) {
    const residual = r.value - (r.includes || []).reduce((s, c) => s + REC.find(x => x.id === c).value, 0);
    r.residual = residual;
    if (residual < 0) { log('K 警告：剩余为负', r.id, residual); continue; }
    if (r.kind === 'island') { add(r.area.island, residual, r); r.islands = 1; continue; }
    const m = own.get(r.id), tot = [...m.values()].reduce((s, v) => s + v, 0);
    r.islands = m.size; r.accommodations = tot;
    if (!tot) { log('K 警告：范围内没有住宿设施', r.id); continue; }
    for (const [id, c] of m) add(id, residual * c / tot, r);
  }
  for (const i of isl) { const o = arr.get(i.id); i.arrivals = o ? Math.round(o.v) : 0; i.arr = o && i.arrivals > 0 ? { kind: o.official && o.recs.length === 1 ? 'official' : 'estimate', recs: o.recs } : null; }
  log('K 有客流的岛', isl.filter(i => i.arrivals > 0).length, '合计', isl.reduce((s, i) => s + i.arrivals, 0));
  fs.writeFileSync(path.join(DATA, 'arrivals.json'), JSON.stringify(REC.map(({ test, ...r }) => r)));

  // ───── H：分数、名次、中文名 ─────
  // 有官方客流（含分摊估算）的岛：50＋50×对数归一（年客流 / 1000 万）；没有的：网络热度指数 × 0.499（垫底，最高 49.9）
  const r1 = x => Math.round(x * 10) / 10;
  for (const i of isl) {
    const x = { views: i.views, pois: i.pois, density: i.pois / Math.max(i.area, F.a0), links: i.links };
    let s = 0; for (const k of ['views', 'pois', 'density', 'links']) s += F.w[k] * Math.min(1, Math.log1p(x[k]) / Math.log1p(F.cap[k]));
    i.index = r1(100 * s);
    i.score = i.arrivals > 0 ? r1(FA.base + FA.span * Math.min(1, Math.log1p(i.arrivals) / Math.log1p(FA.cap))) : r1(FA.scale * i.index); // 垫底档用取整后的 index，判卷可复算
  }
  isl.sort((a, b) => b.score - a.score || b.area - a.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  isl.forEach((i, n) => { i.rank = n + 1; });
  const zhf = path.join(ROOT, 'tools/names_zh.json'), ZH = fs.existsSync(zhf) ? readJ(zhf) : {};
  for (const i of isl) { const e = i.wd && W.ent[i.wd]; i.name.zh = ZH[i.id] || e?.zh || null; }

  // ───── I：几何（单岛最高精度按 1° 格存）＋ pt 校正 ─────
  log('I 几何');
  fs.rmSync(path.join(DATA, 'geom'), { recursive: true, force: true }); fs.mkdirSync(path.join(DATA, 'geom'));
  const cells = new Map(); let fixed = 0;
  for (const i of isl) {
    const tol = i.area > 1000 ? 0.00008 : i.area > 1 ? 0.00004 : i.area > 0.01 ? 0.00002 : 0;
    const rs = i.rings.map(r => simplifyRing(r, tol).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]));
    i.geom = rs;
    if (!inRings(i.pt, rs) || !inRings(i.pt, i.rings)) { const p = polylabel(rs, 1e-6); if (inRings(p, rs) && inRings(p, i.rings)) { i.pt = p; fixed++; } }
    const cell = Math.floor(i.pt[0]) + '_' + Math.floor(i.pt[1]); i.cell = cell;
    if (!cells.has(cell)) cells.set(cell, {}); cells.get(cell)[i.id] = rs;
  }
  for (const [c, o] of cells) fs.writeFileSync(path.join(DATA, 'geom', c + '.json'), JSON.stringify(o));
  log('I 几何格', cells.size, 'pt 校正', fixed);

  // ───── J：矢量瓦片（渲染用）─────
  if (!process.argv.includes('--no-tiles')) {
    log('J 切瓦片');
    const geojsonvt = require('geojson-vt'), vtpbf = require('vt-pbf');
    const fc = { type: 'FeatureCollection', features: isl.map(i => ({ type: 'Feature', properties: { id: i.id, s: i.score }, geometry: { type: 'Polygon', coordinates: i.geom } })) };
    const MAXZ = 12, index = (geojsonvt.default || geojsonvt)(fc, { maxZoom: MAXZ, indexMaxZoom: 5, indexMaxPoints: 0, tolerance: 1.5, buffer: 16, extent: 4096 });
    fs.rmSync(path.join(DATA, 'tiles'), { recursive: true, force: true });
    let n = 0, bytes = 0; const have = {};
    const walk = (z, x, y) => {
      const t = index.getTile(z, x, y); if (!t || !t.features.length) return;
      const buf = Buffer.from(vtpbf.fromGeojsonVt({ islands: t }, { version: 2 }));
      const dir = path.join(DATA, 'tiles', String(z), String(x)); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, y + '.pbf'), buf); n++; bytes += buf.length; (have[z] = have[z] || []).push(x + '/' + y);
      if (z < MAXZ) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) walk(z + 1, x * 2 + dx, y * 2 + dy);
    };
    walk(0, 0, 0);
    fs.writeFileSync(path.join(DATA, 'tiles', 'index.json'), JSON.stringify({ maxzoom: MAXZ, have }));
    log('J 瓦片', n, '个', (bytes / 1e6).toFixed(1), 'MB');
  }

  // ───── 输出 ─────
  const out = isl.map(i => ({ id: i.id, name: i.name, pt: i.pt.map(v => +v.toFixed(6)), bbox: i.bbox.map(v => +v.toFixed(6)), area: +i.area.toFixed(7), prov: i.prov, osm: i.osm, wd: i.wd, wiki: i.wiki, sig: { views: i.views, pois: i.pois, links: i.links, arrivals: i.arrivals }, arr: i.arr, index: i.index, score: i.score, rank: i.rank, cell: i.cell }));
  fs.writeFileSync(path.join(DATA, 'islands.json'), JSON.stringify(out));
  fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify({ count: out.length, viewsPeriod: PERIOD, formula: { ...F, arrivals: FA }, built: new Date().toISOString().slice(0, 10), sources: ['OpenStreetMap land polygons 2026-09-28 (ODbL)', 'OpenStreetMap place/tourism tags (ODbL)', 'geoBoundaries (CC BY 3.0 IGO)', 'Wikidata (CC0)', 'Wikimedia pageviews'] }));
  log('完成', out.length, '座；前 20：', out.slice(0, 20).map(i => `${i.rank}.${i.name.en || '?'}(${i.score})`).join(' '));
}
main().catch(e => { console.error(e); process.exit(1); });
