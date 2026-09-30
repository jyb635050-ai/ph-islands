// 菲律宾海岛热度地图（PH Islands）验收脚本 —— 判卷标准，冻结，任何人不许改（改了就算不合格）。
// 用法（在 D:\blender\PHIslands 下）：
//   node tools/accept.mjs            本地全量：自带静态服务器，站点挂在 /ph-islands/ 子路径（和 GitHub Pages 一样）
//   node tools/accept.mjs --url https://jyb635050-ai.github.io/ph-islands/
//                                    线上：data/ 下三个 json 必须与本地逐字节相同，另跑 geo page mobile 三组
//   node tools/accept.mjs --prove    反向验证：逐个注入破坏，对应检查必须变红。全部抓到 → 退出码 1；有漏抓 → 退出码 2
//   --only 组名,组名   只跑某几组（调试用）：data geo signals details page mobile。交付必须跑全量
//   --seed N           固定抽样种子（默认每次随机，输出里会打印）
//   --sab 名字         只注入一种破坏跑一遍（调试反向验证用，名字见文件末尾 SABS 表）
// 全部 PASS 退出码 0；任一 FAIL 退出码 1。截图写到 shots/。signals、details 两组要联网（维基、Wikidata、OSM、Commons 接口，被限流会自动等）。
// 耗时参考（管理者样板站实测）：全量约 10–20 分钟，--prove 约 1 小时；真实数据会更久
//
// ───── 数据契约 ─────
// 岛＝OSM 海岸线陆地多边形的一块（osmdata.openstreetmap.de land-polygons-complete-4326），只收菲律宾的：
//   东沙岛、南海争议岛礁（东经 117° 以西且北纬 8.5° 以北）、马来西亚／印尼的岛（按 geoBoundaries 国界）一律不收。
// data/islands.json  数组，每项一座岛：
//   id    字符串 ^[a-z0-9-]{1,40}$，唯一
//   name  {en: 字符串|null, zh: 字符串|null}；热度前 100 名两个都必须有
//   pt    [经度, 纬度]，岛内部一点（判卷在这里点击、取色；必须落在 geom(id) 多边形内部）
//   bbox  [西, 南, 东, 北]
//   area  km²，完整精度多边形的球面面积（地球半径 6371.0088 km，外环减内洞）
//   prov  pt 所在的省（geoBoundaries PHL ADM2 的 shapeName 原文，见 PROV 表）；pt 不在任何省内就取最近的省
//   osm   命名来源 "node/123"|"way/123"|"relation/123"|null；wd  Wikidata "Q123"|null
//   wiki  英文维基条目标题|null——必须是这座岛本身的条目（Wikidata 上是岛），不许借城镇／省的条目
//   sig   {views, pois, links} 非负整数：
//         views＝wiki 条目在 meta.viewsPeriod 12 个月的访问量合计（Wikimedia pageviews：en.wikipedia, all-access, user, monthly），无 wiki 为 0
//         pois ＝岛多边形内的 OSM 旅游点个数：tourism=hotel|guest_house|resort|hostel|motel|apartment|camp_site|attraction|viewpoint|museum、
//                leisure=beach_resort、amenity=dive_centre（点，或线／面取中心点）
//         links＝wd 的 Wikidata 站点链接数（sitelinks），无 wd 为 0
//   score 0–100，一位小数，严格按 meta.formula 算；rank 名次（1 起）＝按 (score 降序, area 降序, id 升序) 排序的位置
// data/meta.json  { count: 岛数, viewsPeriod: ["YYYY-MM","YYYY-MM"]（连续 12 个月，结束月 ≥ 2026-06）,
//                   formula: { w:{views,pois,density,links}（≥0，和为 1）, cap:{views,pois,density,links}（>0）, a0（km²，>0） } }
//   score＝round1(100 × Σ w_k × min(1, ln(1+x_k)/ln(1+cap_k)))（判卷重算，容差 0.1）；x_views=views，x_pois=pois，x_density=pois/max(area,a0)，x_links=links
//   同一公式对每座岛一视同仁，不许给单座岛调分
// data/details.json  数组，热度前 100 名每座一项（多写不扣分）：
//   { id, intro:{zh 60–400 字, en 40–300 词}, spots:[3–6 个 {name:{zh,en}, ref:"node/123"|"way/123"|"relation/123"|"Q123", pt:[经,纬]}],
//     sources:[https 网址 ≥1], photo:{file:"assets/…"（≤300 KB，宽 ≥480 像素）, commons:"File:…", author, license} }
//   spot：ref 指向的 OSM 元素／Wikidata 条目名字要和 name.en 对得上、坐标离 spot.pt ≤2 km；spot.pt 离岛的 bbox ≤10 km
//   photo：必须是 Wikimedia Commons 上 commons 那张图的缩小／重压缩版（不许裁切、调色），许可只收 CC0／Public domain／CC BY／CC BY-SA
//   sources：判卷抽查，打开要 200 且正文 ≥300 字
//
// ───── 页面契约 ─────
// 首页 index.html；地图用 WebGL 画在 <canvas> 上（MapLibre GL 之类）；页面运行时加载的数据（含几何、瓦片）都放在 data/ 下
// 深链接 #/i/<id> 打开即显示该岛详情；点开某岛后地址栏 hash 变成 #/i/<id>
// window.__isl：
//   ready           数据与地图首帧就绪后置 true
//   fly(id)         相机飞到该岛：整岛在没被面板挡住的区域内、尽量放大（岛太小就到最大缩放级），返回 Promise，停稳后 resolve
//   home()          回到全国视图：全部岛都在没被面板挡住的区域内，返回 Promise
//   project([经,纬]) → {x,y} 视口 CSS 像素
//   at([经,纬])     → 该点所在岛的 id，海上返回 null
//   geom(id)        → Promise<GeoJSON Polygon|MultiPolygon>，本站拥有的最高精度几何
//   color(score)    → 该分数的岛填充色（CSS 颜色字符串）
//   labels(on)      开／关地图上全部文字标签（判卷取色前关掉）
// 热力：fly 之后 pt 处像素＝color(score)（允许 ±40 色阶；发光／热力层此时要淡出）；
//       全国视图下热度前 10 名的岛，pt 周围 5 像素内要看得到接近 color(score) 的颜色（10 座里 ≥7 座）
// data-testid：
//   map 地图容器；count 文字里有岛数（与 islands.json 条数相同）
//   searchbar 搜索面板；search 搜索框 <input>；result 搜索结果项（data-id），英文名和中文名都能搜，500 ms 内出结果，最相关的排第一
//   top 热度榜面板（桌面默认看不到时，点 top-toggle 打开）；top-item 榜单项（data-id），按名次列出前 100 名
//   detail 详情面板（data-id＝当前岛），点岛后 400 ms 内出现；close 关闭按钮；Esc 也能关
//     d-name 名字（无名岛写「无名岛」/"Unnamed island"）；d-area 面积（≥3 位有效数字，单位 km² 或 m²）；d-score 热度分；d-rank 名次
//     d-prov 省；d-pois 旅游点数；d-near 离它最近的前 100 名岛（不含自己）的名字＋距离 km（pt 到 pt 的大圆距离）
//     前 100 名另有：d-intro 介绍；d-spot 每个景点一项（含名字，顺序同 spots）；d-photo 照片 <img>；d-credit 作者＋许可；d-src 出处链接
//   lang 中英切换；默认中文（<html lang> 以 zh 开头），切换后 <html lang> 以 en 开头，名字、介绍、景点随之切换
// 毛玻璃：detail、searchbar、top 的 backdrop-filter 含 blur ≥16px，背景色不透明度 0.2–0.85
// 外域请求只许 glyphs.geolonia.com（地图字形）；不许任何底图瓦片服务；控制台 0 报错；不许原生对话框
// 性能（桌面 1440×900，无头 Chrome）：打开到 ready ≤5 s（线上 ≤12 s）；ready 前传输 ≤6 MB；连续缩放拖动：帧间隔中位 ≤20 ms、p95 ≤34 ms、>50 ms 的帧 ≤3%
// 手机（390×844 触屏）：点岛出详情，面板完整在屏内、顶边 ≥ 屏高 20%；页面不横向滚动；搜索能用

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/73405/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { PNG } = require('pngjs');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA = 'PHIslandsJudge/1.0 (github.com/jyb635050-ai/ph-islands)';
const BUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const PROVE = args.includes('--prove');
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const SAB = args.includes('--sab') ? args[args.indexOf('--sab') + 1] : null;
const SEED = args.includes('--seed') ? +args[args.indexOf('--seed') + 1] : (Date.now() % 1e9);
const SHOT = path.join(ROOT, 'shots');
const SUB = '/ph-islands/';
const OK_HOSTS = ['glyphs.geolonia.com'];

const PROV = ["Abra", "Agusan del Norte", "Agusan del Sur", "Aklan", "Albay", "Antique", "Apayao", "Aurora", "Basilan", "Bataan", "Batanes", "Batangas", "Benguet", "Biliran", "Bohol", "Bukidnon", "Bulacan", "Cagayan", "Camarines Norte", "Camarines Sur", "Camiguin", "Capiz", "Catanduanes", "Cavite", "Cebu", "City of Isabela", "Compostela Valley", "Cotabato", "Cotabato City", "Davao Occidental", "Davao Oriental", "Davao del Norte", "Davao del Sur", "Dinagat Islands", "Eastern Samar", "Guimaras", "Ifugao", "Ilocos Norte", "Ilocos Sur", "Iloilo", "Isabela", "Kalinga", "La Union", "Laguna", "Lanao del Norte", "Lanao del Sur", "Leyte", "Maguindanao", "Marinduque", "Masbate", "Misamis Occidental", "Misamis Oriental", "Mountain Province", "NCR, City of Manila, First District", "NCR, Fourth District", "NCR, Second District", "NCR, Third District", "Negros Occidental", "Negros Oriental", "Northern Samar", "Nueva Ecija", "Nueva Vizcaya", "Occidental Mindoro", "Oriental Mindoro", "Palawan", "Pampanga", "Pangasinan", "Quezon", "Quirino", "Rizal", "Romblon", "Samar", "Sarangani", "Siquijor", "Sorsogon", "South Cotabato", "Southern Leyte", "Sultan Kudarat", "Sulu", "Surigao del Norte", "Surigao del Sur", "Tarlac", "Tawi-Tawi", "Zambales", "Zamboanga Sibugay", "Zamboanga del Norte", "Zamboanga del Sur"];
// 参考岛：点、面积（管理者 2026-09-29 用 2026-09-28 版 land-polygons-complete-4326 实算）、省、famous＝热门性常识检查
const REF = [
  ['Boracay', [121.925, 11.968], 9.9993, 'Aklan', /boracay/i, true],
  ['Siargao', [126.07, 9.87], 366.0466, 'Surigao del Norte', /siargao/i, true],
  ['Palawan', [118.74, 9.74], 11392.2097, 'Palawan', /palawan/i, true],
  ['Panglao', [123.80, 9.58], 90.3014, 'Bohol', /panglao/i, true],
  ['Busuanga', [120.05, 12.10], 935.2868, 'Palawan', /busuanga/i, true],
  ['Coron Island', [120.25, 11.90], 71.9865, 'Palawan', /coron/i, true],
  ['Siquijor', [123.55, 9.20], 319.9218, 'Siquijor', /siquijor/i, true],
  ['Camiguin', [124.72, 9.17], 243.6133, 'Camiguin', /camiguin/i, true],
  ['Malapascua', [124.115, 11.33], 1.5699, 'Cebu', /malapascua/i, true],
  ['Bantayan', [123.76, 11.19], 113.2411, 'Cebu', /bantayan/i, true],
  ['Mactan', [123.99, 10.30], 58.8438, 'Cebu', /mactan/i, true],
  ['Samal', [125.72, 7.10], 252.0892, 'Davao del Norte', /samal/i, true],
  ['Apo Island', [123.27, 9.075], 0.7018, 'Negros Oriental', /apo/i, true],
  ['Bohol', [124.2, 9.85], 3782.7995, 'Bohol', null, false],
  ['Cebu', [123.8, 10.4], 4423.8756, 'Cebu', null, false],
  ['Luzon', [121.0, 15.5], 105297.6431, null, null, false],
  ['Mindanao', [124.8, 7.8], 94283.5151, null, null, false],
  ['Mindoro', [121.0, 13.0], 9861.0099, null, null, false],
  ['Balicasag', [123.683, 9.517], 0.3520, 'Bohol', null, false],
  ['Tubbataha', [119.9974, 8.9303], 0.0182, 'Palawan', null, false],
  ['Apo Reef', [120.4398, 12.668], 0.0239, 'Occidental Mindoro', null, false],
  ['Balintang', [122.1436, 19.9583], 0.5399, null, null, false],
];
// 不许收的：东沙岛（台湾管辖）、仙宾礁一带（南海争议）、米昂阿斯岛（印尼）、马来西亚海龟群岛一块
const OUT = [['东沙岛', [116.7288, 20.7034], 5], ['仙宾礁', [116.46, 9.75], 20], ['Miangas', [126.5835, 5.5559], 3], ['Malaysia turtle isl.', [118.021, 6.116], 1]];
const TOTAL_AREA = 295748, N_MIN = 7700, N_MAX = 7900;

let results = [];
function rec(id, ok, msg) { results.push({ id, ok, msg }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${msg}`); }
const tid = id => `[data-testid="${id}"]`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const want = g => !ONLY || ONLY.includes(g);
let rnd = (() => { let a = SEED >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
const pick = (arr, n) => { const a = arr.slice(), o = []; while (a.length && o.length < n) o.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return o; };
const R = 6371.0088, rad = Math.PI / 180;
function ringArea(r) { let a = 0; for (let i = 0; i < r.length - 1; i++) { const [x1, y1] = r[i], [x2, y2] = r[i + 1]; a += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad)); } return Math.abs(a * R * R / 2); }
const polys = g => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const geomArea = g => polys(g).reduce((s, p) => s + ringArea(p[0]) - p.slice(1).reduce((t, h) => t + ringArea(h), 0), 0);
function pipRing(pt, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }
const inGeom = (pt, g) => polys(g).some(p => pipRing(pt, p[0]) && !p.slice(1).some(h => pipRing(pt, h)));
function hav(a, b) { const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function bboxDist(pt, b) { const x = Math.min(Math.max(pt[0], b[0]), b[2]), y = Math.min(Math.max(pt[1], b[1]), b[3]); return hav(pt, [x, y]); }
const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();
function nameMatch(a, cands) {
  const A = norm(a); if (!A) return false;
  const ta = new Set(A.split(' '));
  return cands.filter(Boolean).some(c => { const C = norm(c); if (!C) return false; if (C.includes(A) || A.includes(C)) return true; const tc = new Set(C.split(' ')); const inter = [...ta].filter(t => tc.has(t)).length; return inter / Math.max(ta.size, tc.size) >= 0.5; });
}
const r1 = x => Math.round(x * 10) / 10;
function scoreOf(isl, F) {
  const x = { views: isl.sig.views, pois: isl.sig.pois, density: isl.sig.pois / Math.max(isl.area, F.a0), links: isl.sig.links };
  let s = 0; for (const k of ['views', 'pois', 'density', 'links']) s += F.w[k] * Math.min(1, Math.log1p(x[k]) / Math.log1p(F.cap[k]));
  return r1(100 * s);
}
const nums = t => (String(t).replace(/(\d)[,，\s](?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) || []).map(Number);
function parseArea(t) {
  const m = String(t).replace(/(\d)[,，\s](?=\d{3}\b)/g, '$1').match(/(\d+(?:\.\d+)?)\s*(km²|km2|平方公里|平方千米|m²|m2|平方米)/i);
  if (!m) return null; const v = +m[1]; return /^(km|平方公里|平方千米)/i.test(m[2]) ? v : v / 1e6;
}
const sigDigits = t => { const m = String(t).replace(/(\d)[,，\s](?=\d{3}\b)/g, '$1').match(/(\d+(?:\.\d+)?)\s*(km|平方|m²|m2)/i); if (!m) return 0; return m[1].replace('.', '').replace(/^0+/, '').length; };

// ───── 静态服务器（sab＝反向验证用的破坏）─────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json', '.pbf': 'application/x-protobuf', '.mvt': 'application/vnd.mapbox-vector-tile', '.pmtiles': 'application/octet-stream', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm' };
function tamper(rel, buf, sab) {
  if (!/^data\/(islands|details)\.json$/.test(rel) || !(sab.arealie || sab.scorelie || sab.viewslie || sab.spotfake || sab.outsider)) return buf;
  const j = JSON.parse(buf.toString('utf8'));
  if (rel === 'data/islands.json') {
    const top = j.slice().sort((a, b) => a.rank - b.rank);
    if (sab.arealie) { const b = j.find(i => /^boracay/i.test(i.name?.en || '')) || top[0]; b.area = +(b.area * 1.05).toFixed(4); }
    if (sab.scorelie) top[3].score = r1(top[3].score + 2);
    if (sab.viewslie) { const b = j.find(i => /^boracay/i.test(i.name?.en || '')) || top[0]; b.sig.views = Math.round(b.sig.views * 1.3); }
    if (sab.outsider) j.push({ ...top[top.length - 1], id: 'probe-pratas', pt: [116.7288, 20.7034], bbox: [116.72, 20.69, 116.74, 20.72] });
  }
  if (rel === 'data/details.json' && sab.spotfake) for (const d of j) for (const s of d.spots || []) { s.name = { zh: '日落天堂湾', en: 'Sunset Paradise Cove' }; }
  return Buffer.from(JSON.stringify(j));
}
function serve(sab = {}) {
  return new Promise(res => {
    const srv = http.createServer(async (req, rsp) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (!u.startsWith(SUB)) { rsp.writeHead(u === '/favicon.ico' ? 404 : 302, { location: SUB }); return rsp.end(); }
      const rel = u.slice(SUB.length);
      if (sab.fat && rel === '__probe.bin') { rsp.writeHead(200, { 'content-type': 'application/octet-stream' }); return rsp.end(Buffer.alloc(7e6, 7)); }
      let f = path.join(ROOT, rel);
      if (!f.startsWith(ROOT)) { rsp.writeHead(403); return rsp.end(); }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) { rsp.writeHead(404); return rsp.end('404'); }
      let buf = fs.readFileSync(f);
      const r = path.relative(ROOT, f).replace(/\\/g, '/');
      buf = tamper(r, buf, sab);
      if (sab.photofake && /^assets\//.test(r) && /\.(webp|jpe?g|png|avif)$/i.test(r) && G.photoSwap && r === G.photoSwap[0]) buf = fs.readFileSync(path.join(ROOT, G.photoSwap[1]));
      if (sab.slow && /^data\//.test(r)) await sleep(6000);
      rsp.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'content-length': buf.length, 'cache-control': 'no-store' });
      rsp.end(buf);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// ───── 注入页面的监听器与破坏 ─────
function probeInit(sab) {
  const RAF = window.requestAnimationFrame.bind(window);
  const P = window.__probe = { frames: [], lastClick: 0 };
  const fr = () => { P.frames.push(performance.now()); if (P.frames.length > 12000) P.frames.splice(0, 3000); RAF(fr); };
  RAF(fr);
  P.stats = (t0, t1) => {
    const f = P.frames.filter(x => x >= t0 && x <= t1), d = [];
    for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
    d.sort((a, b) => a - b);
    return { n: d.length, p50: d.length ? d[Math.floor(d.length * 0.5)] : 999, p95: d.length ? d[Math.min(d.length - 1, Math.floor(d.length * 0.95))] : 999, slow: d.filter(x => x > 50).length };
  };
  for (const ev of ['click', 'pointerup', 'touchend']) window.addEventListener(ev, () => { P.lastClick = performance.now(); }, true);
  if (sab.jank) { const r = window.requestAnimationFrame; window.requestAnimationFrame = cb => r.call(window, t => { const s = performance.now(); while (performance.now() - s < 28); cb(t); }); }
  if (sab.freeze) {
    for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!C) continue;
      for (const f of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'clear']) {
        const o = C.prototype[f]; if (!o) continue;
        C.prototype[f] = function (...a) { if (window.__isl && window.__isl.ready && window.__probeArmed) return; return o.apply(this, a); };
      }
    }
    const iv = setInterval(() => { if (window.__isl && window.__isl.ready) { setTimeout(() => { window.__probeArmed = true; }, 1500); clearInterval(iv); } }, 100);
  }
  if (sab.noclick) for (const ev of ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) window.addEventListener(ev, e => { if (e.target && e.target.tagName === 'CANVAS' && window.__isl && window.__isl.ready) e.stopImmediatePropagation(); }, true);
  if (sab.nosearch) for (const ev of ['input', 'keydown', 'keyup', 'change']) window.addEventListener(ev, e => { if (e.target && e.target.matches && e.target.matches('[data-testid=search]')) e.stopImmediatePropagation(); }, true);
  const css = t => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = t; document.head.appendChild(s); });
  if (sab.noglass) css('*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}');
  if (sab.huelie) css('canvas{filter:hue-rotate(150deg)!important}');
  if (sab.hscroll) css('html,body{overflow-x:visible!important}body::after{content:"";display:block;width:3000px;height:2px}');
  if (sab.ext) document.addEventListener('DOMContentLoaded', () => { const i = new Image(); i.src = 'https://example.com/isl-probe.png'; });
  if (sab.fat) fetch('/ph-islands/__probe.bin').catch(() => { });
  if (sab.cerr) setTimeout(() => console.error('isl-probe error'), 1500);
}

// ───── 公共状态 ─────
const G = { errors: [], external: [], dialogs: [], photoSwap: null };
let BASE, HOST, D = null;
async function getBuf(rel) { const r = await fetch(BASE + rel + (BASE.startsWith('http://127') ? '' : '?t=' + Date.now())); if (!r.ok) throw new Error(`${rel} HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); }
async function loadData() {
  const out = {};
  for (const k of ['islands', 'meta', 'details']) { try { out[k] = JSON.parse((await getBuf(`data/${k}.json`)).toString('utf8')); } catch (e) { out[k] = null; out.err = (out.err || '') + e.message.slice(0, 80) + '；'; } }
  out.isl = Array.isArray(out.islands) ? out.islands : [];
  out.byId = new Map(out.isl.map(i => [i.id, i]));
  out.top = out.isl.filter(i => Number.isInteger(i.rank)).sort((a, b) => a.rank - b.rank);
  out.top100 = out.top.slice(0, 100);
  out.det = new Map((Array.isArray(out.details) ? out.details : []).map(d => [d.id, d]));
  return out;
}
// 维基系接口会 429 限流（2026-09-29 实测 retry-after 32 秒），按服务器要求等
async function jget(url, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    let wait = 1500 * (i + 1);
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(40000) });
      if (r.ok) { const t = await r.text(); try { return JSON.parse(t); } catch (e) { last = '不是 JSON：' + t.slice(0, 40); } }
      else { last = 'HTTP ' + r.status; if (r.status === 404) break; if (r.status === 429) wait = Math.min(90, +(r.headers.get('retry-after') || 30) + 1) * 1000; }
    } catch (e) { last = e.message; }
    await sleep(wait);
  }
  throw new Error(`${url.slice(0, 90)} → ${last}`);
}

// ───── data 组 ─────
async function gData() {
  if (D.err) rec('data.files', false, D.err); else rec('data.files', true, 'islands/meta/details 三个文件都能读');
  const I = D.isl, M = D.meta || {}, bad = [];
  const ids = new Set();
  for (const i of I) {
    const e = [];
    if (typeof i.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(i.id)) e.push('id'); else if (ids.has(i.id)) e.push('id 重复'); ids.add(i.id);
    if (!i.name || !('en' in i.name) || !('zh' in i.name)) e.push('name');
    if (!Array.isArray(i.pt) || i.pt.length !== 2 || !i.pt.every(Number.isFinite)) e.push('pt');
    if (!Array.isArray(i.bbox) || i.bbox.length !== 4 || !(i.bbox[0] <= i.bbox[2] && i.bbox[1] <= i.bbox[3])) e.push('bbox');
    else if (Array.isArray(i.pt) && !(i.pt[0] >= i.bbox[0] && i.pt[0] <= i.bbox[2] && i.pt[1] >= i.bbox[1] && i.pt[1] <= i.bbox[3])) e.push('pt 不在 bbox 内');
    if (!(i.area > 0)) e.push('area');
    if (!PROV.includes(i.prov)) e.push('prov=' + i.prov);
    if (i.osm !== null && !/^(node|way|relation)\/\d+$/.test(i.osm || '')) e.push('osm');
    if (i.wd !== null && !/^Q\d+$/.test(i.wd || '')) e.push('wd');
    if (i.wiki !== null && typeof i.wiki !== 'string') e.push('wiki');
    if (!i.sig || !['views', 'pois', 'links'].every(k => Number.isInteger(i.sig[k]) && i.sig[k] >= 0)) e.push('sig');
    else { if (!i.wiki && i.sig.views) e.push('无 wiki 却有 views'); if (!i.wd && i.sig.links) e.push('无 wd 却有 links'); }
    if (!(i.score >= 0 && i.score <= 100) || r1(i.score) !== i.score) e.push('score');
    if (!Number.isInteger(i.rank)) e.push('rank');
    if (e.length) bad.push(`${i.id}:${e.join('/')}`);
  }
  rec('data.schema', I.length > 0 && bad.length === 0, bad.length ? `${bad.length} 座不合格：` + bad.slice(0, 5).join('；') : `${I.length} 座字段齐全`);
  rec('data.count', I.length >= N_MIN && I.length <= N_MAX && M.count === I.length, `${I.length} 座（应在 ${N_MIN}–${N_MAX}），meta.count=${M.count}`);
  const tot = I.reduce((s, i) => s + (i.area || 0), 0);
  rec('data.total', Math.abs(tot - TOTAL_AREA) / TOTAL_AREA <= 0.01, `面积合计 ${Math.round(tot)} km²（应为 ${TOTAL_AREA} ±1%）`);
  // 公式与名次
  const F = M.formula, okF = F && F.w && F.cap && F.a0 > 0 && ['views', 'pois', 'density', 'links'].every(k => F.w[k] >= 0 && F.cap[k] > 0) && Math.abs(['views', 'pois', 'density', 'links'].reduce((s, k) => s + F.w[k], 0) - 1) < 1e-6;
  if (!okF) rec('data.formula', false, 'meta.formula 不合格（w 非负且和为 1、cap>0、a0>0）');
  else {
    const mis = I.filter(i => i.sig && Math.abs(scoreOf(i, F) - i.score) > 0.11);
    rec('data.formula', I.length > 0 && mis.length === 0, mis.length ? `${mis.length} 座分数不符合公式：` + mis.slice(0, 4).map(i => `${i.id} 写 ${i.score} 算 ${scoreOf(i, F)}`).join('；') : `${I.length} 座分数都按公式重算吻合`);
  }
  const srt = I.slice().sort((a, b) => b.score - a.score || b.area - a.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rbad = srt.filter((i, k) => i.rank !== k + 1);
  rec('data.rank', I.length > 0 && rbad.length === 0, rbad.length ? `${rbad.length} 座名次不对，如 ${rbad[0].id} 写 ${rbad[0].rank}` : '名次与排序一致');
  const vp = M.viewsPeriod; let vpOk = Array.isArray(vp) && vp.length === 2 && /^\d{4}-\d{2}$/.test(vp[0]) && /^\d{4}-\d{2}$/.test(vp[1]);
  if (vpOk) { const [y0, m0] = vp[0].split('-').map(Number), [y1, m1] = vp[1].split('-').map(Number); vpOk = (y1 * 12 + m1) - (y0 * 12 + m0) === 11 && vp[1] >= '2026-06'; }
  rec('data.period', vpOk, `viewsPeriod=${JSON.stringify(vp)}（连续 12 个月，结束 ≥2026-06）`);
  const noName = D.top100.filter(i => !i.name?.en || !i.name?.zh).map(i => i.id);
  rec('data.names', D.top100.length === 100 && noName.length === 0, noName.length ? '前 100 名缺中/英文名：' + noName.slice(0, 6).join(',') : `前 ${D.top100.length} 名中英文名齐全`);
  // 详情
  const dbad = [], missing = D.top100.filter(i => !D.det.has(i.id)).map(i => i.id);
  for (const d of D.det.values()) {
    const i = D.byId.get(d.id), e = [];
    if (!i) { dbad.push(`${d.id}:没这座岛`); continue; }
    const zh = String(d.intro?.zh || '').replace(/\s/g, ''), enw = String(d.intro?.en || '').trim().split(/\s+/).filter(Boolean).length;
    if (zh.length < 60 || zh.length > 400) e.push(`中文介绍 ${zh.length} 字`);
    if (enw < 40 || enw > 300) e.push(`英文介绍 ${enw} 词`);
    if (!Array.isArray(d.spots) || d.spots.length < 3 || d.spots.length > 6) e.push('景点数');
    else for (const s of d.spots) {
      if (!s.name?.zh || !s.name?.en) e.push('景点名');
      if (!/^((node|way|relation)\/\d+|Q\d+)$/.test(s.ref || '')) e.push('景点 ref');
      if (!Array.isArray(s.pt) || bboxDist(s.pt, i.bbox) > 10) e.push(`景点「${s.name?.en}」离岛 >10 km`);
    }
    if (!Array.isArray(d.sources) || !d.sources.length || !d.sources.every(u => /^https:\/\//.test(u))) e.push('sources');
    const p = d.photo || {};
    if (!p.file || !p.commons || !/^File:/.test(p.commons) || !p.author || !p.license) e.push('photo 字段');
    else {
      try { const b = await getBuf(p.file); const md = await sharp(b).metadata(); if (b.length > 300 * 1024) e.push(`照片 ${Math.round(b.length / 1024)} KB`); if (md.width < 480) e.push(`照片宽 ${md.width}`); }
      catch (err) { e.push('照片打不开'); }
    }
    if (e.length) dbad.push(`${d.id}:${[...new Set(e)].join('/')}`);
  }
  rec('data.details', D.top100.length === 100 && missing.length === 0 && dbad.length === 0, (missing.length ? `前 100 名缺详情 ${missing.length} 座（${missing.slice(0, 4).join(',')}）；` : '') + (dbad.length ? dbad.slice(0, 4).join('；') : `详情 ${D.det.size} 座字段合格`));
}

// ───── 浏览器通用 ─────
async function newPage(browser, sab, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, deviceScaleFactor: opts.dpr || 1, isMobile: !!opts.mobile, hasTouch: !!opts.mobile, userAgent: opts.mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36' : BUA, locale: 'zh-CN' });
  await ctx.addInitScript(probeInit, sab);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') G.errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', e => G.errors.push('pageerror ' + String(e.message).slice(0, 140)));
  page.on('dialog', d => { G.dialogs.push(d.type()); d.dismiss().catch(() => { }); });
  page.on('request', r => { try { const h = new URL(r.url()).host; if (/^(data|blob):/.test(r.url())) return; if (h !== HOST && !OK_HOSTS.includes(h)) G.external.push(h); } catch (e) { } });
  return page;
}
async function openReady(page, hash = '') {
  const t0 = Date.now();
  await page.goto(BASE + hash, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForFunction(() => window.__isl && window.__isl.ready === true, null, { timeout: 40000, polling: 50 });
  return Date.now() - t0;
}
async function pngOf(page) { return PNG.sync.read(await page.screenshot()); }
function px(img, x, y) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null; const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; }
const cdist = (p, q) => (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / 3;
function nearest(img, x, y, r, target) { let best = 999; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const p = px(img, x + dx, y + dy); if (p) best = Math.min(best, cdist(p, target)); } return best; }
function median(img, x, y, r) { const ps = []; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const p = px(img, x + dx, y + dy); if (p) ps.push(p); } if (!ps.length) return [0, 0, 0]; return [0, 1, 2].map(c => ps.map(p => p[c]).sort((a, b) => a - b)[Math.floor(ps.length / 2)]); }
function diffRatio(a, b, thr = 24) { if (a.width !== b.width || a.height !== b.height) return 1; let n = 0; const N = a.width * a.height; for (let i = 0; i < N * 4; i += 4) if (Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2])) > thr) n++; return n / N; }
async function rgbOf(page, css) { return page.evaluate(c => { const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d'); x.fillStyle = '#000'; x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); }, css); }
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
async function closeDetail(page) { await page.keyboard.press('Escape').catch(() => { }); await sleep(250); }
async function detailText(page, id) { return page.locator(`${tid('detail')} ${tid(id)}`).first().innerText({ timeout: 1500 }).catch(() => ''); }
const dispName = (i, lang) => lang === 'en' ? (i.name?.en || 'Unnamed island') : (i.name?.zh || i.name?.en || '无名岛');

// ───── geo 组：参考岛、不许收的岛、几何 ─────
async function gGeo(browser, sab) {
  const page = await newPage(browser, sab);
  try { await openReady(page); } catch (e) { rec('geo.open', false, '页面没 ready：' + e.message.slice(0, 80)); await page.context().close(); return; }
  G.refIds = {};
  const areaBad = [], provBad = [], nameBad = [], pipBad = [];
  for (const [n, pt, a, prov, re] of REF) {
    const id = await page.evaluate(p => window.__isl.at(p), pt).catch(() => null);
    const i = id && D.byId.get(id);
    if (!i) { areaBad.push(`${n}:at() 找不到岛`); continue; }
    G.refIds[n] = id;
    if (Math.abs(i.area - a) / a > 0.015) areaBad.push(`${n}:${i.area}≠${a}`);
    if (prov && i.prov !== prov) provBad.push(`${n}:${i.prov}≠${prov}`);
    if (re && !re.test(i.name?.en || '')) nameBad.push(`${n}:${i.name?.en}`);
    const g = await page.evaluate(x => window.__isl.geom(x), id).catch(() => null);
    if (!g || !inGeom(pt, g) || !inGeom(i.pt, g)) pipBad.push(`${n}:参考点或 pt 不在 geom 内`);
    else if (Math.abs(geomArea(g) - i.area) / i.area > (i.area >= 1 ? 0.05 : 0.15)) pipBad.push(`${n}:geom 面积 ${geomArea(g).toFixed(3)} 与 area ${i.area} 差太多`);
  }
  rec('geo.area', areaBad.length === 0, areaBad.length ? areaBad.slice(0, 5).join('；') : `${REF.length} 座参考岛面积都在 ±1.5% 内`);
  rec('geo.prov', provBad.length === 0 && areaBad.length === 0, provBad.length ? provBad.join('；') : '参考岛省份正确');
  rec('geo.name', nameBad.length === 0 && areaBad.length === 0, nameBad.length ? '名字不对：' + nameBad.join('；') : '热门参考岛名字对得上');
  const out = [];
  for (const [n, pt, rkm] of OUT) {
    const id = await page.evaluate(p => window.__isl.at(p), pt).catch(() => 'err');
    const near = D.isl.filter(i => Array.isArray(i.pt) && hav(i.pt, pt) <= rkm);
    if (id !== null || near.length) out.push(`${n}${id ? '（at=' + id + '）' : ''}${near.length ? '（' + near.length + ' 座 pt 在 ' + rkm + ' km 内）' : ''}`);
  }
  rec('geo.out', out.length === 0, out.length ? '收了不该收的：' + out.join('；') : '东沙岛、南海争议岛礁、印尼、马来西亚的岛都没收');
  // 随机抽 40 座：pt 在 geom 内、geom 面积与 area 相符
  for (const i of pick(D.isl, 40)) {
    const g = await page.evaluate(x => window.__isl.geom(x), i.id).catch(() => null);
    if (!g || !inGeom(i.pt, g)) { pipBad.push(`${i.id}:pt 不在 geom 内`); continue; }
    const ga = geomArea(g), tol = i.area >= 1 ? 0.05 : i.area >= 0.01 ? 0.15 : 0.5;
    if (Math.abs(ga - i.area) / i.area > tol) pipBad.push(`${i.id}:geom ${ga.toFixed(4)} vs area ${i.area}`);
  }
  rec('geo.geom', pipBad.length === 0, pipBad.length ? pipBad.slice(0, 5).join('；') : '参考岛＋随机 40 座：pt 在岛内，几何面积与 area 相符');
  const fam = REF.filter(r => r[5]).map(r => [r[0], D.byId.get(G.refIds[r[0]])]);
  const bor = fam[0][1], inTop = fam.filter(([, i]) => i && i.rank <= 60);
  rec('geo.famous', !!bor && bor.rank <= 5 && inTop.length >= 9, `长滩岛第 ${bor?.rank} 名（应 ≤5）；13 座知名旅游岛进前 60 名的有 ${inTop.length} 座（应 ≥9）：${fam.map(([n, i]) => n + '#' + (i?.rank ?? '?')).join(' ')}`);
  await page.context().close();
}

// ───── signals 组（联网）─────
async function gSignals() {
  const M = D.meta || {}, vp = M.viewsPeriod || ['2025-07', '2026-06'];
  const withWiki = D.isl.filter(i => i.wiki && i.sig?.views > 0);
  const bor = D.isl.find(i => /^boracay$/i.test(i.name?.en || '')) || D.top[0];
  const vs = [...new Set([bor, ...pick(withWiki.filter(i => i !== bor), 5)].filter(Boolean))];
  const end = new Date(Date.UTC(+vp[1].slice(0, 4), +vp[1].slice(5, 7), 0));
  const vbad = [];
  for (const i of vs) {
    try {
      if (!i.wiki) { vbad.push(`${i.id}:没有 wiki`); continue; }
      const t = encodeURIComponent(i.wiki.replace(/ /g, '_'));
      const j = await jget(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${t}/monthly/${vp[0].replace('-', '')}0100/${end.toISOString().slice(0, 10).replace(/-/g, '')}00`);
      const sum = (j.items || []).reduce((s, x) => s + x.views, 0);
      if (Math.abs(sum - i.sig.views) > Math.max(50, sum * 0.03)) vbad.push(`${i.wiki}:写 ${i.sig.views} 实 ${sum}`);
    } catch (e) { vbad.push(`${i.wiki}:${e.message.slice(0, 60)}`); }
  }
  rec('signals.views', vs.length > 0 && vbad.length === 0, vbad.length ? vbad.join('；') : `${vs.length} 座访问量与 Wikimedia 接口吻合：` + vs.map(i => i.wiki).join(', '));
  // wiki 条目＝这座岛本身（Wikidata 是岛，且就是 wd）
  const ibad = [];
  try {
    const titles = vs.map(i => i.wiki).filter(Boolean);
    const j = await jget(`https://www.wikidata.org/w/api.php?action=wbgetentities&redirects=no&sites=enwiki&titles=${encodeURIComponent(titles.join('|'))}&props=sitelinks&sitefilter=enwiki&format=json`);
    const q = {}; for (const e of Object.values(j.entities || {})) if (e.sitelinks?.enwiki) q[e.sitelinks.enwiki.title] = e.id;
    const vals = Object.values(q).map(x => 'wd:' + x).join(' ');
    const sp = await jget(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(`SELECT ?i WHERE { VALUES ?i { ${vals} } ?i wdt:P31/wdt:P279* wd:Q23442 . }`)}`);
    const isl = new Set((sp.results?.bindings || []).map(b => b.i.value.split('/').pop()));
    for (const i of vs) { const e = q[i.wiki.replace(/_/g, ' ')] || q[i.wiki]; if (!e) ibad.push(`${i.wiki}:找不到 Wikidata`); else if (e !== i.wd) ibad.push(`${i.wiki}:条目是 ${e}，wd 写 ${i.wd}`); else if (!isl.has(e)) ibad.push(`${i.wiki}:${e} 在 Wikidata 上不是岛`); }
  } catch (e) { ibad.push(e.message.slice(0, 80)); }
  rec('signals.article', vs.length > 0 && ibad.length === 0, ibad.length ? ibad.join('；') : '抽查的 wiki 条目都是岛本身、与 wd 一致');
  const ls = [...new Set([bor, ...pick(D.isl.filter(i => i.wd && i !== bor), 5)].filter(i => i && i.wd))];
  const lbad = [];
  try {
    const j = await jget(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ls.map(i => i.wd).join('|')}&props=sitelinks&format=json`);
    for (const i of ls) { const n = Object.keys(j.entities?.[i.wd]?.sitelinks || {}).length; if (Math.abs(n - i.sig.links) > Math.max(3, n * 0.1)) lbad.push(`${i.wd}:写 ${i.sig.links} 实 ${n}`); }
  } catch (e) { lbad.push(e.message.slice(0, 80)); }
  rec('signals.links', ls.length > 0 && lbad.length === 0, lbad.length ? lbad.join('；') : `${ls.length} 座 sitelinks 与 Wikidata 吻合`);
}

// ───── details 组（联网）─────
async function osmRef(ref) {
  if (/^Q\d+$/.test(ref)) {
    const j = await jget(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ref}&props=labels|aliases|claims&languages=en&format=json`);
    const e = j.entities[ref]; const c = e?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    return { names: [e?.labels?.en?.value, ...(e?.aliases?.en || []).map(a => a.value)], pt: c ? [c.longitude, c.latitude] : null };
  }
  const [t, id] = ref.split('/');
  if (t === 'node') { const j = await jget(`https://api.openstreetmap.org/api/0.6/node/${id}.json`); const e = j.elements[0]; return { names: [e.tags?.name, e.tags?.['name:en'], e.tags?.alt_name, e.tags?.official_name], pt: [e.lon, e.lat] }; }
  const j = await jget(`https://api.openstreetmap.org/api/0.6/${t}/${id}/full.json`);
  const me = j.elements.find(e => e.type === t && String(e.id) === id), ns = j.elements.filter(e => e.type === 'node');
  const pt = ns.length ? [ns.reduce((s, n) => s + n.lon, 0) / ns.length, ns.reduce((s, n) => s + n.lat, 0) / ns.length] : null;
  return { names: [me?.tags?.name, me?.tags?.['name:en'], me?.tags?.alt_name, me?.tags?.official_name], pt };
}
async function texSig(buf) {
  const raw = Float64Array.from(await sharp(buf).resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer());
  const m = raw.reduce((s, v) => s + v, 0) / raw.length; let v2 = 0; const a = raw.map(v => v - m); a.forEach(v => v2 += v * v);
  const sd = Math.sqrt(v2 / a.length) || 1; return a.map(v => v / sd);
}
async function gDetails() {
  const dets = [...D.det.values()].filter(d => D.byId.has(d.id));
  const first = D.top.map(i => D.det.get(i.id)).filter(Boolean);
  // 景点
  const allSpots = dets.flatMap(d => (d.spots || []).map(s => [d, s]));
  const sp = [...new Set([...(first[0]?.spots || []).slice(0, 1).map(s => [first[0], s]), ...pick(allSpots, 23)])];
  const sbad = [];
  for (const [d, s] of sp) {
    try { const r = await osmRef(s.ref); if (!nameMatch(s.name?.en, r.names)) sbad.push(`${d.id}「${s.name?.en}」≠ ${s.ref} 的名字 ${r.names.filter(Boolean)[0]}`); else if (!r.pt || hav(r.pt, s.pt) > 2) sbad.push(`${d.id}「${s.name?.en}」坐标离 ${s.ref} ${r.pt ? hav(r.pt, s.pt).toFixed(1) : '?'} km`); }
    catch (e) { sbad.push(`${d.id}「${s.name?.en}」${s.ref}:${e.message.slice(0, 50)}`); }
    await sleep(300);
  }
  rec('details.spots', sp.length > 0 && sbad.length === 0, sbad.length ? `${sbad.length}/${sp.length} 个景点对不上：` + sbad.slice(0, 4).join('；') : `抽查 ${sp.length} 个景点，名字和坐标都对得上 OSM/Wikidata`);
  // 出处
  const urls = [...new Set(dets.flatMap(d => d.sources || []))];
  const us = pick(urls, 12), ubad = [];
  for (const u of us) {
    try { const r = await fetch(u, { headers: { 'user-agent': BUA, 'accept-language': 'en,zh;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(30000) }); const t = (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); if (r.status !== 200 || t.length < 300) ubad.push(`${u} → ${r.status}/${t.length} 字`); }
    catch (e) { ubad.push(`${u} → ${e.message.slice(0, 40)}`); }
  }
  rec('details.sources', us.length > 0 && ubad.length === 0, ubad.length ? ubad.slice(0, 4).join('；') : `抽查 ${us.length} 个出处都能打开且有正文`);
  // 照片
  const ps = [...new Set([...first.slice(0, 2), ...pick(dets, 10)])].filter(d => d.photo?.commons);
  const pbad = [];
  for (const d of ps) {
    try {
      const j = await jget(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(d.photo.commons)}&prop=imageinfo&iiprop=extmetadata|url&iiurlwidth=640&format=json`);
      const ii = Object.values(j.query?.pages || {})[0]?.imageinfo?.[0];
      if (!ii) { pbad.push(`${d.id}:Commons 上没有 ${d.photo.commons}`); continue; }
      const lic = ii.extmetadata?.LicenseShortName?.value || '';
      if (!/^(cc0|public domain|pd\b|cc[ -]by(-sa)?(\s|$|-?\d))/i.test(lic.trim())) { pbad.push(`${d.id}:许可「${lic}」不收`); continue; }
      let tb = null;
      for (let k = 0; k < 5 && !tb; k++) { const r = await fetch(ii.thumburl, { headers: { 'user-agent': UA } }).catch(() => null); if (r && r.ok) tb = Buffer.from(await r.arrayBuffer()); else await sleep(r && r.status === 429 ? Math.min(90, +(r.headers.get('retry-after') || 30) + 1) * 1000 : 2000); }
      if (!tb) { pbad.push(`${d.id}:Commons 缩略图下载失败`); continue; }
      const [a, b] = await Promise.all([texSig(tb), texSig(await getBuf(d.photo.file))]);
      let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; const c = s / a.length;
      if (c < 0.85) pbad.push(`${d.id}:本地照片与 Commons 原图不是同一张（相关 ${c.toFixed(2)}）`);
    } catch (e) { pbad.push(`${d.id}:${e.message.slice(0, 60)}`); }
  }
  rec('details.photo', ps.length > 0 && pbad.length === 0, pbad.length ? pbad.slice(0, 4).join('；') : `抽查 ${ps.length} 张照片：许可合格、与 Commons 原图一致`);
}

// ───── page 组（桌面）─────
async function gPage(browser, sab) {
  const page = await newPage(browser, sab);
  const cdp = await page.context().newCDPSession(page); await cdp.send('Network.enable');
  let bytes = 0, counting = true; cdp.on('Network.loadingFinished', e => { if (counting) bytes += e.encodedDataLength; });
  let tReady;
  try { tReady = await openReady(page); } catch (e) { rec('page.load', false, '40 秒内没 ready：' + e.message.slice(0, 60)); await page.context().close(); return; }
  await sleep(300); counting = false;
  const lim = urlArg ? 12000 : 5000;
  rec('page.load', tReady <= lim, `打开到 ready ${tReady} ms（应 ≤${lim}）`);
  rec('page.bytes', bytes <= 6e6, `ready 前传输 ${(bytes / 1e6).toFixed(2)} MB（应 ≤6）`);
  const ct = await page.locator(tid('count')).first().innerText().catch(() => '');
  rec('page.count', D.isl.length > 0 && nums(ct).includes(D.isl.length), `count 显示「${ct.slice(0, 40)}」，数据 ${D.isl.length} 座`);
  const lang0 = await page.evaluate(() => document.documentElement.lang);
  // 全国视图热力
  try {
    await page.evaluate(() => window.__isl.home()); await page.evaluate(() => window.__isl.labels(false)); await sleep(900);
    const img = await pngOf(page); fs.writeFileSync(path.join(SHOT, 'home.png'), PNG.sync.write(img));
    let hit = 0; const miss = [];
    for (const i of D.top.slice(0, 10)) { const p = await page.evaluate(x => window.__isl.project(x), i.pt); const c = await rgbOf(page, await page.evaluate(s => window.__isl.color(s), i.score)); if (nearest(img, p.x, p.y, 5, c) <= 60) hit++; else miss.push(i.id); }
    const hotCold = cdist(await rgbOf(page, await page.evaluate(() => window.__isl.color(90))), await rgbOf(page, await page.evaluate(() => window.__isl.color(3))));
    rec('heat.overview', hit >= 7 && hotCold >= 60, `全国视图前 10 名看得到热度色 ${hit}/10（应 ≥7）${miss.length ? '，看不到：' + miss.slice(0, 4).join(',') : ''}；90 分与 3 分颜色差 ${hotCold.toFixed(0)}（应 ≥60）`);
    await page.evaluate(() => window.__isl.labels(true));
  } catch (e) { rec('heat.overview', false, e.message.slice(0, 100)); }
  // 拖动：画面要变、中心要变
  try {
    const A = await pngOf(page); const m = page.viewportSize(); const ref = D.top[0].pt, p0 = await page.evaluate(x => window.__isl.project(x), ref);
    await page.mouse.move(m.width * 0.55, m.height * 0.5); await page.mouse.down(); for (let k = 1; k <= 12; k++) { await page.mouse.move(m.width * 0.55 - 30 * k, m.height * 0.5 - 8 * k); await sleep(16); } await page.mouse.up(); await sleep(800);
    const B = await pngOf(page), dr = diffRatio(A, B), p1 = await page.evaluate(x => window.__isl.project(x), ref);
    const mv = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    rec('page.pan', dr >= 0.03 && mv >= 200, `拖动 360 像素后画面变化 ${(dr * 100).toFixed(1)}%（应 ≥3%），地图跟手移动 ${mv.toFixed(0)} 像素（应 ≥200）`);
  } catch (e) { rec('page.pan', false, e.message.slice(0, 80)); }
  // 帧率：滚轮缩放＋拖动约 6 秒
  try {
    const m = page.viewportSize(), bor = D.isl.find(i => /^boracay$/i.test(i.name?.en || '')) || D.top[0];
    await page.evaluate(() => window.__isl.home()); await sleep(500);
    const t0 = await page.evaluate(() => performance.now());
    const c = await page.evaluate(x => window.__isl.project(x), bor.pt);
    await page.mouse.move(c.x, c.y);
    for (let k = 0; k < 14; k++) { await page.mouse.wheel(0, -240); await sleep(110); }
    for (let r = 0; r < 3; r++) { await page.mouse.down(); for (let k = 0; k < 20; k++) { await page.mouse.move(c.x + (r % 2 ? -1 : 1) * 12 * k, c.y + 5 * k); await sleep(16); } await page.mouse.up(); await sleep(100); }
    for (let k = 0; k < 14; k++) { await page.mouse.wheel(0, 240); await sleep(110); }
    await page.mouse.down(); for (let k = 0; k < 30; k++) { await page.mouse.move(m.width / 2 + 10 * k, m.height / 2 - 4 * k); await sleep(16); } await page.mouse.up(); await sleep(600);
    const st = await page.evaluate(t => window.__probe.stats(t, performance.now()), t0);
    rec('page.fps', st.n > 60 && st.p50 <= 20 && st.p95 <= 34 && st.slow <= st.n * 0.03, `缩放拖动 ${st.n} 帧：中位 ${st.p50.toFixed(1)} ms（应 ≤20）、p95 ${st.p95.toFixed(1)} ms（应 ≤34），>50 ms 的 ${st.slow} 帧（应 ≤${Math.floor(st.n * 0.03)}）`);
  } catch (e) { rec('page.fps', false, e.message.slice(0, 80)); }
  // 点岛：前 3 名、3 座中游、2 座无名小岛
  const mid = pick(D.isl.filter(i => i.rank > 100 && i.rank <= 2500 && i.area >= 0.05), 3);
  const tiny = pick(D.isl.filter(i => !i.name?.en && i.area >= 0.001 && i.area < 0.05), 2);
  const targets = [...D.top.slice(0, 3), ...mid, ...tiny];
  const cbad = [], fbad = [], lat = [], hbad = [];
  let fillN = 0;
  for (const i of targets) {
    try {
      await closeDetail(page);
      await page.evaluate(x => window.__isl.fly(x), i.id); await page.evaluate(() => window.__isl.labels(false)); await sleep(500);
      const p = await page.evaluate(x => window.__isl.project(x), i.pt);
      const img = await pngOf(page); const col = await rgbOf(page, await page.evaluate(s => window.__isl.color(s), i.score));
      const d = cdist(median(img, p.x, p.y, 2), col); if (d <= 40) fillN++; else hbad.push(`${i.id}:色差 ${d.toFixed(0)}`);
      if (fillN === 0 && hbad.length === 1) fs.writeFileSync(path.join(SHOT, `fill-${i.id}.png`), PNG.sync.write(img));
      await page.evaluate(() => window.__isl.labels(true)); await sleep(150);
      const under = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); const m = document.querySelector('[data-testid=map]'); return !!(e && m && m.contains(e)); }, p);
      if (!under) { cbad.push(`${i.id}:pt 被面板挡住或在屏外`); continue; }
      await page.mouse.click(p.x, p.y);
      const ms = await page.waitForFunction(id => { const e = document.querySelector('[data-testid=detail]'); if (!e || e.dataset.id !== id) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e); if (r.width < 10 || r.height < 10 || s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.5) return false; return performance.now() - window.__probe.lastClick; }, i.id, { timeout: 3000, polling: 'raf' }).then(h => h.jsonValue()).catch(() => null);
      if (ms == null) { cbad.push(`${i.id}:点了 3 秒没出详情`); continue; }
      lat.push(ms);
      const hash = await page.evaluate(() => location.hash);
      if (hash !== '#/i/' + i.id) cbad.push(`${i.id}:hash=${hash}`);
      fbad.push(...(await checkDetail(page, i, 'zh')));
    } catch (e) { cbad.push(`${i.id}:${e.message.slice(0, 60)}`); }
  }
  rec('heat.fill', targets.length >= 6 && fillN >= targets.length - 1, `放大后 pt 处颜色＝color(score) 的 ${fillN}/${targets.length}（最多错 1 座）${hbad.length ? '：' + hbad.slice(0, 3).join('；') : ''}`);
  rec('page.click', targets.length >= 6 && cbad.length === 0, cbad.length ? cbad.slice(0, 4).join('；') : `${targets.length} 座岛点击都出详情、hash 正确`);
  lat.sort((a, b) => a - b);
  rec('page.latency', lat.length > 0 && lat[lat.length - 1] <= 400, `点击到详情出现最慢 ${lat.length ? lat[lat.length - 1].toFixed(0) : '?'} ms（应 ≤400）`);
  rec('page.detail', targets.length >= 6 && fbad.length === 0 && cbad.length === 0, fbad.length ? fbad.slice(0, 5).join('；') : '详情字段（名字/面积/分数/名次/省/旅游点/最近热门岛/介绍/景点/照片/出处）全部对得上');
  // 关闭
  try {
    await page.locator(tid('close')).first().click({ timeout: 2000 }); await sleep(400); const a = await visible(page, tid('detail'));
    await page.evaluate(x => window.__isl.fly(x), D.top[0].id); const p = await page.evaluate(x => window.__isl.project(x), D.top[0].pt); await page.mouse.click(p.x, p.y); await sleep(500);
    const b = await visible(page, tid('detail')); await closeDetail(page); const c = await visible(page, tid('detail'));
    rec('page.close', !a && b && !c, `关闭按钮后${a ? '还在' : '关了'}，再点开${b ? '出现' : '没出现'}，Esc 后${c ? '还在' : '关了'}`);
  } catch (e) { rec('page.close', false, e.message.slice(0, 80)); }
  // 搜索
  try {
    const bor = D.isl.find(i => G.refIds && i.id === G.refIds.Boracay) || D.isl.find(i => /^boracay$/i.test(i.name?.en || ''));
    const res = [];
    for (const q of ['Boracay', (bor?.name?.zh || '长滩岛').slice(0, 2)]) {
      await page.locator(tid('search')).first().fill(''); await page.locator(tid('search')).first().click(); await page.keyboard.type(q, { delay: 20 });
      const t = Date.now();
      const first = await page.waitForFunction(() => { const r = document.querySelector('[data-testid=result]'); return r && r.getBoundingClientRect().height > 0 ? r.dataset.id : false; }, null, { timeout: 2000, polling: 30 }).then(h => h.jsonValue()).catch(() => null);
      res.push([q, first, Date.now() - t]);
    }
    await page.locator(tid('result')).first().click(); await sleep(1600);
    const did = await page.locator(tid('detail')).first().getAttribute('data-id').catch(() => null);
    const v = await page.evaluate(x => window.__isl.project(x), bor.pt); const vp = page.viewportSize();
    const ok = bor && res.every(r => r[1] === bor.id && r[2] <= 600) && did === bor.id && v.x > 0 && v.x < vp.width && v.y > 0 && v.y < vp.height;
    rec('page.search', !!ok, res.map(r => `「${r[0]}」第一条 ${r[1]}（${r[2]} ms）`).join('；') + `，点结果后详情 ${did}，长滩岛${v.x > 0 && v.x < vp.width ? '在' : '不在'}画面内`);
  } catch (e) { rec('page.search', false, e.message.slice(0, 80)); }
  // 热度榜
  try {
    await closeDetail(page);
    if (!(await visible(page, tid('top')))) await page.locator(tid('top-toggle')).first().click({ timeout: 2000 });
    await sleep(500);
    const got = await page.locator(tid('top-item')).evaluateAll(es => es.map(e => e.dataset.id));
    const exp = D.top100.map(i => i.id); const same = got.length >= 100 && exp.every((id, k) => got[k] === id);
    await page.locator(tid('top-item')).nth(4).click(); await sleep(1500);
    const did = await page.locator(tid('detail')).first().getAttribute('data-id').catch(() => null);
    rec('page.top', same && did === exp[4], `榜单 ${got.length} 项${same ? '顺序正确' : '顺序/数量不对'}；点第 5 项详情 ${did}（应 ${exp[4]}）`);
  } catch (e) { rec('page.top', false, e.message.slice(0, 80)); }
  // 毛玻璃
  try {
    const gl = await page.evaluate(() => ['detail', 'searchbar', 'top'].map(k => { const e = document.querySelector(`[data-testid=${k}]`); if (!e) return [k, 0, -1]; const s = getComputedStyle(e); const f = s.backdropFilter || s.webkitBackdropFilter || ''; const b = /blur\((\d+(?:\.\d+)?)px\)/.exec(f); const m = /rgba?\(([^)]+)\)/.exec(s.backgroundColor); const a = m ? (m[1].split(',')[3] === undefined ? 1 : +m[1].split(',')[3]) : 1; return [k, b ? +b[1] : 0, a]; }));
    const bad = gl.filter(([, b, a]) => b < 16 || a < 0.2 || a > 0.85);
    rec('glass', bad.length === 0, gl.map(([k, b, a]) => `${k} blur ${b}px 不透明度 ${a}`).join('；'));
  } catch (e) { rec('glass', false, e.message.slice(0, 80)); }
  // 语言
  try {
    await closeDetail(page);
    const t = D.top[0], d = D.det.get(t.id);
    await page.locator(tid('lang')).first().click(); await sleep(500);
    const lang1 = await page.evaluate(() => document.documentElement.lang);
    await page.evaluate(x => window.__isl.fly(x), t.id); const p = await page.evaluate(x => window.__isl.project(x), t.pt); await page.mouse.click(p.x, p.y); await sleep(600);
    const bad = await checkDetail(page, t, 'en');
    await closeDetail(page); await page.locator(tid('lang')).first().click(); await sleep(400);
    const lang2 = await page.evaluate(() => document.documentElement.lang);
    rec('page.lang', /^zh/i.test(lang0) && /^en/i.test(lang1) && /^zh/i.test(lang2) && bad.length === 0 && !!d, `默认 ${lang0} → 切换 ${lang1} → 切回 ${lang2}${bad.length ? '；英文详情不对：' + bad.slice(0, 3).join('；') : '；英文详情正确'}`);
  } catch (e) { rec('page.lang', false, e.message.slice(0, 80)); }
  await page.context().close();
  // 深链接
  const dp = await newPage(browser, sab);
  try {
    const t = D.top[6] || D.top[0]; await openReady(dp, '#/i/' + t.id);
    const ok = await dp.waitForFunction(id => { const e = document.querySelector('[data-testid=detail]'); return !!(e && e.dataset.id === id && e.getBoundingClientRect().height > 10); }, t.id, { timeout: 4000 }).then(() => true).catch(() => false);
    rec('page.deeplink', ok, `打开 #/i/${t.id} ${ok ? '直接显示详情' : '没显示详情'}`);
  } catch (e) { rec('page.deeplink', false, e.message.slice(0, 80)); }
  await dp.context().close();
}
async function checkDetail(page, i, lang) {
  const bad = [], tx = async k => detailText(page, k), dn = dispName(i, lang);
  const name = await tx('d-name'); if (!name.includes(dn)) bad.push(`${i.id} d-name「${name.slice(0, 20)}」缺「${dn}」`);
  const at = await tx('d-area'), av = parseArea(at);
  if (av == null || Math.abs(av - i.area) / i.area > 0.01 || sigDigits(at) < 3 && Math.abs(av - i.area) / i.area > 0.001) bad.push(`${i.id} d-area「${at.slice(0, 24)}」≠ ${i.area} km²`);
  const sc = nums(await tx('d-score')); if (!sc.some(v => Math.abs(v - i.score) <= 0.51)) bad.push(`${i.id} d-score≠${i.score}`);
  const rk = nums(await tx('d-rank')); if (!rk.includes(i.rank)) bad.push(`${i.id} d-rank≠${i.rank}`);
  const pv = await tx('d-prov'); if (!pv.includes(i.prov)) bad.push(`${i.id} d-prov「${pv.slice(0, 20)}」≠${i.prov}`);
  const po = nums(await tx('d-pois')); if (!po.includes(i.sig.pois)) bad.push(`${i.id} d-pois≠${i.sig.pois}`);
  const nb = D.top100.filter(t => t.id !== i.id).map(t => [t, hav(i.pt, t.pt)]).sort((a, b) => a[1] - b[1])[0];
  if (nb) { const nt = await tx('d-near'); if (!nt.includes(dispName(nb[0], lang)) || !nums(nt).some(v => Math.abs(v - nb[1]) <= Math.max(1, nb[1] * 0.05))) bad.push(`${i.id} d-near「${nt.slice(0, 30)}」应含 ${dispName(nb[0], lang)} ${nb[1].toFixed(1)} km`); }
  const d = D.det.get(i.id);
  if (i.rank <= 100) {
    if (!d) { bad.push(`${i.id} 没有详情数据`); return bad; }
    const it = (await tx('d-intro')).replace(/\s+/g, ' '), want = String(d.intro?.[lang] || '').replace(/\s+/g, ' ').slice(0, 20);
    if (!want || !it.includes(want)) bad.push(`${i.id} d-intro 不含介绍开头「${want}」`);
    const spots = await page.locator(`${tid('detail')} ${tid('d-spot')}`).allInnerTexts().catch(() => []);
    if (spots.length !== d.spots.length || !d.spots.every((s, k) => (spots[k] || '').includes(s.name?.[lang]))) bad.push(`${i.id} d-spot ${spots.length} 项与 ${d.spots.length} 个景点对不上`);
    const ph = await page.evaluate(() => { const e = document.querySelector('[data-testid=detail] [data-testid=d-photo]'); const im = e && (e.tagName === 'IMG' ? e : e.querySelector('img')); return im ? [im.complete, im.naturalWidth, im.currentSrc || im.src] : null; });
    if (!ph || !ph[0] || ph[1] < 400 || !decodeURI(ph[2]).includes(d.photo.file)) bad.push(`${i.id} d-photo 没显示 ${d.photo?.file}`);
    const cr = await tx('d-credit'); if (!cr.includes(String(d.photo?.author).slice(0, 12)) || !cr.includes(d.photo?.license)) bad.push(`${i.id} d-credit 缺作者或许可`);
    const hs = await page.locator(`${tid('detail')} ${tid('d-src')} a`).evaluateAll(es => es.map(e => e.href)).catch(() => []);
    if (!d.sources.every(u => hs.includes(u))) bad.push(`${i.id} d-src 缺出处链接`);
  }
  return bad;
}

// ───── mobile 组 ─────
async function gMobile(browser, sab) {
  const page = await newPage(browser, sab, { viewport: { width: 390, height: 844 }, dpr: 2, mobile: true });
  try {
    await openReady(page);
    const hs = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    rec('mobile.hscroll', hs <= 1, `页面宽出 ${hs} 像素（应 ≤1）`);
    const t = D.top[1] || D.top[0];
    await page.evaluate(x => window.__isl.fly(x), t.id); await sleep(400);
    const p = await page.evaluate(x => window.__isl.project(x), t.pt);
    await page.touchscreen.tap(p.x, p.y); await sleep(900);
    const bb = await page.locator(tid('detail')).first().boundingBox().catch(() => null);
    const id = await page.locator(tid('detail')).first().getAttribute('data-id').catch(() => null);
    const ok = bb && id === t.id && bb.x >= -1 && bb.x + bb.width <= 391 && bb.y >= 844 * 0.2 && bb.y + bb.height <= 845;
    rec('mobile.detail', !!ok, bb ? `详情 ${id}：x ${bb.x.toFixed(0)} y ${bb.y.toFixed(0)} 宽 ${bb.width.toFixed(0)} 高 ${bb.height.toFixed(0)}` : '点岛没出详情');
    await page.screenshot({ path: path.join(SHOT, 'mobile.png') });
    await closeDetail(page);
    if (await visible(page, tid('detail'))) { await page.locator(tid('close')).first().tap().catch(() => { }); await sleep(300); }
    await page.locator(tid('search')).first().tap(); await page.keyboard.type('Siargao', { delay: 20 });
    const first = await page.waitForFunction(() => { const r = document.querySelector('[data-testid=result]'); return r && r.getBoundingClientRect().height > 0 ? r.dataset.id : false; }, null, { timeout: 2000 }).then(h => h.jsonValue()).catch(() => null);
    const sg = D.isl.find(i => /^siargao/i.test(i.name?.en || ''));
    const hs2 = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    rec('mobile.search', !!sg && first === sg.id && hs2 <= 1, `手机搜「Siargao」第一条 ${first}（应 ${sg?.id}），宽出 ${hs2}`);
  } catch (e) { rec('mobile.crash', false, e.message.slice(0, 100)); }
  await page.context().close();
}

// ───── 主流程 ─────
async function runAll(sab = {}, groups = null) {
  results = []; G.errors = []; G.external = []; G.dialogs = [];
  const on = g => (!groups || groups.includes(g)) && want(g);
  let srv = null;
  if (urlArg) { BASE = urlArg.endsWith('/') ? urlArg : urlArg + '/'; HOST = new URL(BASE).host; }
  else { srv = await serve(sab); BASE = `http://127.0.0.1:${srv.address().port}${SUB}`; HOST = `127.0.0.1:${srv.address().port}`; }
  fs.mkdirSync(SHOT, { recursive: true });
  D = await loadData();
  if (urlArg) {
    for (const f of ['islands', 'meta', 'details']) {
      try { const b = await getBuf(`data/${f}.json`); const l = fs.readFileSync(path.join(ROOT, `data/${f}.json`)); rec('online.' + f, b.equals(l), b.equals(l) ? '线上与本地逐字节相同' : `线上 ${b.length} 字节，本地 ${l.length}`); }
      catch (e) { rec('online.' + f, false, e.message.slice(0, 60)); }
    }
  }
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
  const GR = [['data', gData], ['geo', gGeo], ['signals', gSignals], ['details', gDetails], ['page', gPage], ['mobile', gMobile]];
  for (const [name, fn] of GR) {
    if (!on(name)) continue;
    if (urlArg && ['data', 'signals', 'details'].includes(name)) continue;
    try { await fn(browser, sab); } catch (e) { rec(name + '.crash', false, e.message.slice(0, 150)); }
  }
  if (['geo', 'page', 'mobile'].some(on)) {
    rec('console', G.errors.length === 0, G.errors.length ? `${G.errors.length} 条报错：` + G.errors.slice(0, 3).join(' | ') : '控制台无报错');
    rec('net.external', G.external.length === 0, G.external.length ? '请求了不许的外域：' + [...new Set(G.external)].slice(0, 4).join(' | ') : '外域只有 ' + OK_HOSTS.join(','));
    rec('dialog', G.dialogs.length === 0, G.dialogs.length ? '弹了原生对话框 ' + G.dialogs.join(',') : '没有原生对话框');
  }
  await browser.close(); if (srv) srv.close();
  return results;
}

console.log(`抽样种子 ${SEED}（复现用 --seed ${SEED}）`);
const watchdog = setTimeout(() => { console.log('FAIL watchdog 判卷超时（正常 60 分钟 / --prove 240 分钟），强制退出'); process.exit(PROVE ? 2 : 1); }, (PROVE ? 240 : 60) * 60000);
if (!PROVE) {
  const r = await runAll(SAB ? { [SAB]: true } : {});
  const f = r.filter(x => !x.ok);
  console.log(`\n${r.length - f.length}/${r.length} PASS${f.length ? '，FAIL：' + f.map(x => x.id).join(' ') : ''}`);
  clearTimeout(watchdog); process.exit(f.length ? 1 : 0);
} else {
  if (urlArg) { console.log('--prove 只在本地跑'); process.exit(2); }
  // 照片调包：拿第 1 名的照片冒充第 2 名的
  try { const dd = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/islands.json'), 'utf8')).sort((a, b) => a.rank - b.rank); const det = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/details.json'), 'utf8')).map(d => [d.id, d])); G.photoSwap = [det.get(dd[1].id).photo.file, det.get(dd[0].id).photo.file]; } catch (e) { }
  const SABS = [
    ['jank', ['page'], ['page.fps'], '每帧卡 28 ms'],
    ['freeze', ['page'], ['page.pan'], '地图画面冻结'],
    ['noclick', ['page'], ['page.click', 'page.latency', 'page.detail'], '点岛没反应'],
    ['slow', ['page'], ['page.load'], '数据慢 6 秒'],
    ['fat', ['page'], ['page.bytes'], '首屏多下 7 MB'],
    ['huelie', ['page'], ['heat.fill', 'heat.overview'], '地图颜色跑偏'],
    ['noglass', ['page'], ['glass'], '去掉毛玻璃'],
    ['nosearch', ['page'], ['page.search'], '搜索框失灵'],
    ['ext', ['page'], ['net.external'], '偷偷请求外域'],
    ['cerr', ['page'], ['console'], '控制台报错'],
    ['hscroll', ['mobile'], ['mobile.hscroll'], '手机横向滚动'],
    ['arealie', ['geo'], ['geo.area'], '长滩岛面积 +5%'],
    ['scorelie', ['data'], ['data.formula'], '第 4 名分数 +2'],
    ['outsider', ['geo'], ['geo.out'], '收进东沙岛'],
    ['viewslie', ['signals'], ['signals.views'], '长滩岛访问量 ×1.3'],
    ['spotfake', ['details'], ['details.spots'], '景点名编造'],
    ['photofake', ['details'], ['details.photo'], '照片调包'],
  ];
  let miss = 0;
  for (const [k, groups, ids, name] of SABS) {
    const r = await runAll({ [k]: true }, groups);
    const caught = r.filter(x => ids.includes(x.id) && !x.ok);
    console.log(`\n>>> 破坏「${name}」${caught.length ? '被抓到：' + caught.map(x => x.id).join(',') : '没被抓到！'}\n`);
    if (!caught.length) miss++;
  }
  console.log(miss ? `\n反向验证：${miss} 种破坏没被抓到 → 退出码 2` : `\n反向验证：${SABS.length} 种破坏全部被抓到 → 退出码 1`);
  clearTimeout(watchdog); process.exit(miss ? 2 : 1);
}
