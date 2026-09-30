// 给前 100 名每座岛列景点候选（Wikidata 条目＋OSM 有名字的旅游点），落在岛上或离岸 3 km 内，按知名度排序。
// 输出 tools/.cache/candidates.json，供人工挑选景点、写介绍时参考。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const isl = J('data/islands.json').sort((a, b) => a.rank - b.rank).slice(0, 100);
const raw = J('tools/.cache/content_raw.json');
const pois = J('tools/cache/osm-tourism-pois-2026-09-29.json').elements;
const extra = fs.existsSync(path.join(ROOT, 'tools/.cache/osm_extra_spots.json')) ? J('tools/.cache/osm_extra_spots.json').elements : [];
const R = 6371.0088, rad = Math.PI / 180;
const hav = (a, b) => { const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const pipRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) c = !c; } return c; };
const cells = {}; const geom = i => (cells[i.cell] = cells[i.cell] || J(`data/geom/${i.cell}.json`))[i.id];
// 点到岛的距离：在岛内 0，否则到最近顶点（抽样）
function distTo(p, i) {
  const g = geom(i); if (pipRing(p, g[0])) return 0;
  const b = i.bbox; if (p[0] < b[0] - 0.1 || p[0] > b[2] + 0.1 || p[1] < b[1] - 0.1 || p[1] > b[3] + 0.1) return 99;
  let m = 99; const r = g[0], step = Math.max(1, Math.floor(r.length / 4000)); for (let k = 0; k < r.length; k += step) m = Math.min(m, hav(p, r[k])); return m;
}
const out = [];
for (const i of isl) {
  const b = i.bbox, near = p => p[0] >= b[0] - 0.1 && p[0] <= b[2] + 0.1 && p[1] >= b[1] - 0.1 && p[1] <= b[3] + 0.1;
  const wd = raw.spots.filter(s => s.en && near(s.pt) && s.q !== i.wd).map(s => ({ ref: s.q, en: s.en, zh: s.zh, pt: s.pt, sl: s.sl, cls: s.cls, d: +distTo(s.pt, i).toFixed(2) })).filter(s => s.d <= 9).sort((a, c) => (a.d > 3) - (c.d > 3) || c.sl - a.sl).slice(0, 14);
  const seen = new Set(); const os = [...pois.filter(e => e.tags?.name && /attraction|viewpoint|museum/.test(e.tags.tourism || '')), ...extra.filter(e => e.tags?.name)].filter(e => !seen.has(e.type + e.id) && seen.add(e.type + e.id)).map(e => ({ e, p: e.center ? [e.center.lon, e.center.lat] : [e.lon, e.lat] })).filter(({ p }) => near(p)).map(({ e, p }) => ({ ref: `${e.type}/${e.id}`, en: e.tags['name:en'] || e.tags.name, pt: [+p[0].toFixed(6), +p[1].toFixed(6)], t: e.tags.tourism || e.tags.natural || e.tags.historic || e.tags.man_made || e.tags.leisure || e.tags.amenity, d: +distTo(p, i).toFixed(2) })).filter(s => s.d <= 9).sort((a, c) => (a.d > 3) - (c.d > 3) || a.d - c.d).slice(0, 16);
  out.push({ rank: i.rank, id: i.id, en: i.name.en, zh: i.name.zh, prov: i.prov, area: i.area, wiki: i.wiki, intro: raw['x:' + i.wiki]?.text?.slice(0, 900) || null, page: raw['x:' + i.wiki]?.page || null, p18: raw['p18:' + i.wd] || [], wd, osm: os });
}
fs.writeFileSync(path.join(ROOT, 'tools/.cache/candidates.json'), JSON.stringify(out, null, 1));
console.log('景点候选：', out.map(o => `${o.rank}.${o.en}:${o.wd.length}+${o.osm.length}`).join(' '));
console.log('候选不足 3 个的岛：', out.filter(o => o.wd.length + o.osm.length < 3).map(o => `${o.rank}.${o.en}`).join(', '));
