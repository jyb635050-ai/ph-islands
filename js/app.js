// 岛热 · 菲律宾海岛热度地图
(async () => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const PH = [116.9, 4.5, 126.7, 21.2];

  // ── 色带：冷（浅薄荷）→ 热（珊瑚红）──
  const RAMP = [[0, [214, 236, 208]], [20, [180, 223, 170]], [42, [255, 228, 138]], [58, [255, 190, 104]], [72, [255, 128, 92]], [88, [232, 64, 86]], [100, [196, 34, 88]]];
  const rgbOf = s => { s = Math.max(0, Math.min(100, s)); for (let k = 1; k < RAMP.length; k++) if (s <= RAMP[k][0]) { const [a, ca] = RAMP[k - 1], [b, cb] = RAMP[k], t = (s - a) / (b - a); return ca.map((v, i) => Math.round(v + (cb[i] - v) * t)); } return RAMP[RAMP.length - 1][1]; };
  const color = s => `rgb(${rgbOf(s).join(',')})`;
  const rampExpr = key => ['interpolate', ['linear'], ['get', key], ...RAMP.flatMap(([s, c]) => [s, `rgb(${c.join(',')})`])];

  // ── 文案 ──
  const T = {
    zh: { brand: '岛热', search: '搜索海岛（中英文名）', count: n => `菲律宾 ${n.toLocaleString('en')} 座岛的热度`, unnamed: '无名岛', top: '热度榜 Top 100', topBtn: '热度榜', low: '冷门', high: '热门',
      score: '热度', rank: '热度名次', area: '面积', prov: '所属省', pois: n => `岛上旅游点（酒店、度假村、潜水店、景点）${n} 个`, near: (n, d) => `离它最近的热门岛：${n} · ${d} km`,
      why: '网络热度（对数加权，客流缺失时用于排名）', arrT: '年游客量', arrOff: '官方统计', arrEst: '估算：官方数字按住宿设施分摊', arrNone: '暂无可核实的官方客流统计，本岛按网络热度排在有客流的岛之后', arrSrc: '客流出处', ppl: '人', topSub: '按年游客量排名', views: '维基访问', poisL: '旅游点', dens: '旅游点密度', links: '维基语种', viewsU: '次/年', linksU: '种',
      spots: '热门景点', src: '出处', photo: '照片', sub: (p, id) => `${p} · 菲律宾`, noIntro: '这座岛没有收录介绍——只有知名旅游岛和年游客 5 万以上的岛有精写内容。',
      credit: '客流：DOT 各大区及省市旅游办公布数字（见各岛出处）· 数据：© OpenStreetMap 贡献者（ODbL）· geoBoundaries · Wikidata · Wikipedia 访问量 · 照片：Wikimedia Commons', home: '全国' },
    en: { brand: 'PH Islands', search: 'Search islands', count: n => `Heat map of ${n.toLocaleString('en')} Philippine islands`, unnamed: 'Unnamed island', top: 'Top 100 hottest', topBtn: 'Top 100', low: 'Quiet', high: 'Hot',
      score: 'Heat', rank: 'Heat rank', area: 'Area', prov: 'Province', pois: n => `Tourism places on the island (hotels, resorts, dive shops, sights): ${n}`, near: (n, d) => `Nearest hot island: ${n} · ${d} km`,
      why: 'Online buzz (log-weighted; used when no visitor data)', arrT: 'Annual visitors', arrOff: 'official count', arrEst: 'estimate: official figure split by accommodations', arrNone: 'No verifiable official visitor count; ranked by online buzz below islands with visitor data', arrSrc: 'Visitor data source', ppl: '', topSub: 'ranked by annual visitors', views: 'Wiki views', poisL: 'Tourism POIs', dens: 'POI density', links: 'Wiki languages', viewsU: '/yr', linksU: '',
      spots: 'Highlights', src: 'Sources', photo: 'Photo', sub: (p, id) => `${p} · Philippines`, noIntro: 'No write-up for this island — curated content covers well-known destinations and islands with 50,000+ visitors a year.',
      credit: 'Visitors: DOT regional & local tourism office figures (see each island) · Data: © OpenStreetMap contributors (ODbL) · geoBoundaries · Wikidata · Wikipedia pageviews · Photos: Wikimedia Commons', home: 'Country' },
  };
  let lang = 'zh';
  const L = () => T[lang];

  // ── 数据 ──
  const base = new URL('.', location.href).href;
  const [isl, meta, tileIdx, recs] = await Promise.all(['data/islands.json', 'data/meta.json', 'data/tiles/index.json', 'data/arrivals.json'].map(f => fetch(f).then(r => r.json())));
  const recById = new Map(recs.map(r => [r.id, r]));
  const byId = new Map(isl.map(i => [i.id, i])), top = isl.slice().sort((a, b) => a.rank - b.rank), top100 = top.slice(0, 100);
  let details = null; const detP = fetch('data/details.json').then(r => r.json()).then(d => { details = new Map(d.map(x => [x.id, x])); return details; });
  const nm = i => lang === 'en' ? (i.name.en || T.en.unnamed) : (i.name.zh || i.name.en || T.zh.unnamed);
  const R = 6371.0088, rad = Math.PI / 180;
  const hav = (a, b) => { const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const pipRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) c = !c; } return c; };
  const inRings = (p, rs) => pipRing(p, rs[0]) && !rs.slice(1).some(h => pipRing(p, h));
  const cellCache = new Map();
  const cellOf = c => { if (!cellCache.has(c)) cellCache.set(c, fetch(`data/geom/${c}.json`).then(r => r.json())); return cellCache.get(c); };
  const fmtArea = a => a >= 100 ? `${Math.round(a).toLocaleString('en')} km²` : a >= 1 ? `${a.toFixed(2)} km²` : a >= 0.01 ? `${a.toFixed(4)} km²` : `${Math.round(a * 1e6).toLocaleString('en')} m²`;
  const fmtN = n => n >= 1e4 ? (lang === 'zh' ? `${(n / 1e4).toFixed(1)} 万` : `${(n / 1e3).toFixed(0)}k`) : n.toLocaleString('en');

  // ── 瓦片：只请求存在的，海面直接给空瓦片（不产生 404）──
  const have = new Set(Object.entries(tileIdx.have).flatMap(([z, a]) => a.map(k => `${z}/${k}`)));
  maplibregl.addProtocol('isl', async (params) => {
    const k = params.url.replace('isl://', '');
    if (!have.has(k)) return { data: new ArrayBuffer(0) };
    const r = await fetch(`${base}data/tiles/${k}.pbf`); return { data: await r.arrayBuffer() };
  });

  // ── 地图 ──
  const mobile = () => innerWidth <= 760;
  const pad = () => { const d = !$('detail').hidden, t = !$('top').hidden;
    if (mobile()) return { top: 140, bottom: d ? Math.round(innerHeight * 0.6) : t ? Math.round(innerHeight * 0.47) : 60, left: 24, right: 24 };
    return { top: 80, bottom: 70, left: t ? 440 : 440, right: d ? 420 : 40 }; };
  const map = new maplibregl.Map({
    container: 'map', attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, maxZoom: 18, minZoom: 3.5, renderWorldCopies: false,
    maxBounds: [[100, -12], [145, 32]], fadeDuration: 150,
    style: { version: 8, glyphs: 'https://glyphs.geolonia.com/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'sea', type: 'background', paint: { 'background-color': '#bfe7f6' } }] },
    bounds: PH, fitBoundsOptions: { padding: pad() },
  });
  map.touchZoomRotate.disableRotation();
  const ptsFC = { type: 'FeatureCollection', features: isl.map(i => ({ type: 'Feature', properties: { id: i.id, s: i.score, zh: i.name.zh || i.name.en || '', en: i.name.en || '', r: i.rank }, geometry: { type: 'Point', coordinates: i.pt } })) };
  let labelsOn = true;
  map.on('load', () => {
    map.addSource('isl', { type: 'vector', tiles: ['isl://{z}/{x}/{y}'], minzoom: 0, maxzoom: tileIdx.maxzoom, bounds: PH });
    map.addSource('pts', { type: 'geojson', data: ptsFC });
    map.addSource('small', { type: 'geojson', data: { type: 'FeatureCollection', features: ptsFC.features.filter(f => byId.get(f.properties.id).area < 300) } });
    // 卡通柔影：往右下偏的模糊描边
    map.addLayer({ id: 'shadow', type: 'line', source: 'isl', 'source-layer': 'islands', paint: { 'line-color': 'rgba(24,88,128,.22)', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 6, 16, 12], 'line-blur': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 12, 6], 'line-translate': [2, 3] } });
    // 浅滩光晕
    map.addLayer({ id: 'shoal', type: 'line', source: 'isl', 'source-layer': 'islands', minzoom: 7, paint: { 'line-color': 'rgba(255,255,255,.55)', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3, 14, 14], 'line-blur': 4, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 9, 1] } });
    map.addLayer({ id: 'fill', type: 'fill', source: 'isl', 'source-layer': 'islands', paint: { 'fill-color': rampExpr('s') } });
    map.addLayer({ id: 'edge', type: 'line', source: 'isl', 'source-layer': 'islands', paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 9, 1.4, 15, 2.6] } });
    map.addLayer({ id: 'sel', type: 'line', source: 'isl', 'source-layer': 'islands', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#10283d', 'line-width': 2.2 } });
    // 全国视图：热门小岛发光点（放大后淡出）
    map.addLayer({ id: 'glow', type: 'circle', source: 'small', filter: ['>=', ['get', 's'], 18], paint: {
      'circle-color': rampExpr('s'), 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['interpolate', ['linear'], ['get', 's'], 18, 2.5, 100, 10], 8, ['interpolate', ['linear'], ['get', 's'], 18, 5, 100, 16]],
      'circle-blur': 0.45, 'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6.5, 0.95, 8.5, 0], 'circle-stroke-color': 'rgba(255,255,255,.7)', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6.5, 0.6, 8.5, 0] } });
    map.addLayer({ id: 'core', type: 'circle', source: 'small', filter: ['>=', ['get', 's'], 18], paint: { 'circle-color': rampExpr('s'), 'circle-radius': ['interpolate', ['linear'], ['get', 's'], 18, 1.5, 100, 4], 'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6.5, 1, 8.5, 0] } });
    map.addLayer({ id: 'lbl', type: 'symbol', source: 'pts', filter: ['all', ['!=', ['get', 'zh'], ''], ['any', ['<=', ['get', 'r'], 40], ['>=', ['zoom'], 8]]],
      layout: { 'text-field': ['get', 'zh'], 'text-font': ['Noto Sans CJK JP Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 12, 14], 'text-variable-anchor': ['bottom', 'top', 'left', 'right'], 'text-radial-offset': 0.9, 'text-padding': 4, 'symbol-sort-key': ['get', 'r'] },
      paint: { 'text-color': '#10283d', 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 1.6 } });
    applyLang();
    map.fitBounds(PH, { padding: pad(), duration: 0 });
    map.once('idle', () => { window.__isl.ready = true; route(); setTimeout(prefetchPhotos, 1200); });
  });
  const settle = () => new Promise(res => { let done = false; const fin = () => { if (!done) { done = true; map.once('idle', res); setTimeout(res, 4000); } }; map.once('moveend', fin); setTimeout(fin, 2500); });
  const flyTo = (id, animate = true) => { const i = byId.get(id); const p = settle(); map.fitBounds([[i.bbox[0], i.bbox[1]], [i.bbox[2], i.bbox[3]]], { padding: pad(), maxZoom: 17, duration: animate ? 900 : 0, essential: true }); return p; };

  window.__isl = {
    ready: false,
    fly: id => flyTo(id),
    home() { const p = settle(); map.fitBounds(PH, { padding: pad(), duration: 700 }); return p; },
    project(ll) { const p = map.project(ll); return { x: p.x, y: p.y }; },
    async at(ll) {
      const c = isl.filter(i => ll[0] >= i.bbox[0] && ll[0] <= i.bbox[2] && ll[1] >= i.bbox[1] && ll[1] <= i.bbox[3]).sort((a, b) => a.area - b.area);
      for (const i of c) { const g = (await cellOf(i.cell))[i.id]; if (g && inRings(ll, g)) return i.id; }
      return null;
    },
    async geom(id) { const i = byId.get(id); if (!i) return null; const g = (await cellOf(i.cell))[id]; return g ? { type: 'Polygon', coordinates: g } : null; },
    color,
    labels(on) { labelsOn = !!on; if (map.getLayer('lbl')) map.setLayoutProperty('lbl', 'visibility', on ? 'visible' : 'none'); },
  };

  map.on('click', e => {
    const f = map.queryRenderedFeatures([[e.point.x - 3, e.point.y - 3], [e.point.x + 3, e.point.y + 3]], { layers: ['fill'] });
    if (f.length) { const exact = map.queryRenderedFeatures(e.point, { layers: ['fill'] }); open((exact[0] || f[0]).properties.id); return; }
    const g = map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], { layers: ['glow'] });
    if (g.length) { const id = g.sort((a, b) => b.properties.s - a.properties.s)[0].properties.id; open(id); flyTo(id); }
  });
  map.on('mousemove', e => { map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers: ['fill', 'glow'] }).length ? 'pointer' : ''; });

  // 就绪后空闲时按热度顺序预取有详情的岛的照片，点开详情时照片立即出现
  async function prefetchPhotos() {
    const m = await detP;
    for (const i of top) { const d = m.get(i.id); if (!d || !d.photo) continue; await new Promise(r => { const im = new Image(); im.onload = im.onerror = r; im.src = d.photo.file; }); }
  }
  // ── 详情 ──
  let cur = null;
  function stat(lbl, val) { return [lbl, val]; }
  function open(id, opts = {}) {
    const i = byId.get(id); if (!i) return; cur = id; const t = L();
    $('detail').dataset.id = id;
    $('dName').textContent = nm(i);
    $('dSub').textContent = (lang === 'zh' && i.name.zh && i.name.en ? i.name.en + ' · ' : lang === 'en' && i.name.zh ? i.name.zh + ' · ' : '') + t.sub(i.prov);
    $('lScore').textContent = t.score; $('lRank').textContent = t.rank; $('lArea').textContent = t.area; $('lProv').textContent = t.prov;
    $('dScore').innerHTML = ''; const dot = el('span', 'dot'); dot.style.background = color(i.score); $('dScore').append(dot, i.score.toFixed(1));
    $('dRank').textContent = `#${i.rank} / ${isl.length.toLocaleString('en')}`;
    $('dArea').textContent = fmtArea(i.area);
    $('dProv').textContent = i.prov;
    const F = meta.formula, x = { views: i.sig.views, pois: i.sig.pois, density: i.sig.pois / Math.max(i.area, F.a0), links: i.sig.links };
    const why = $('why'); why.innerHTML = ''; why.append(el('div', 't', t.why));
    for (const [k, lb, v] of [['views', t.views, `${fmtN(i.sig.views)}${t.viewsU}`], ['pois', t.poisL, String(i.sig.pois)], ['density', t.dens, `${x.density.toFixed(1)}/km²`], ['links', t.links, `${i.sig.links}${t.linksU}`]]) {
      const f = Math.min(1, Math.log1p(x[k]) / Math.log1p(F.cap[k])); const row = el('div', 'b'); const bar = el('i'); const b = el('b'); b.style.width = (f * 100).toFixed(0) + '%'; bar.append(b); row.append(el('span', '', `${lb} ×${F.w[k]}`), bar, el('span', '', v)); why.append(row);
    }
    $('dPois').textContent = t.pois(i.sig.pois);
    const ab = $('dArr'); ab.innerHTML = '';
    if (i.sig.arrivals > 0) {
      const rs = i.arr.recs.map(id => recById.get(id)), yrs = [...new Set(rs.map(r => r.year))].join('/');
      ab.append(el('div', 'lbl', `${t.arrT}（${yrs}）`), el('div', 'big', `${i.arr.kind === 'estimate' ? (lang === 'zh' ? '约 ' : '≈ ') : ''}${i.sig.arrivals.toLocaleString('en')} ${t.ppl}`), el('div', 'kind', i.arr.kind === 'official' ? t.arrOff : t.arrEst));
      const sl = el('div', 'src'); sl.append(t.arrSrc + '：');
      for (const r of rs) { const a = el('a', '', `${r.name[lang]} ${r.year} ${r.approx ? (lang === 'zh' ? '约' : '~') : ''}${r.value.toLocaleString('en')}`); a.href = r.src; a.target = '_blank'; a.rel = 'noopener'; sl.append(a); }
      ab.append(sl);
    } else ab.append(el('div', 'kind', t.arrNone));
    const nb = top100.filter(o => o.id !== id).map(o => [o, hav(i.pt, o.pt)]).sort((a, b) => a[1] - b[1])[0];
    $('dNear').textContent = nb ? t.near(nm(nb[0]), nb[1] < 10 ? nb[1].toFixed(1) : Math.round(nb[1])) : '';
    $('dNear').onclick = nb ? () => { open(nb[0].id); flyTo(nb[0].id); } : null; $('dNear').style.cursor = nb ? 'pointer' : '';
    const rich = $('rich'), pb = $('photoBox'); rich.innerHTML = ''; pb.innerHTML = '';
    const fill = d => {
      if (cur !== id) return; rich.innerHTML = ''; pb.innerHTML = '';
      if (!d) { rich.append(el('p', 'src', t.noIntro)); return; }
      if (d.photo) { const img = el('img'); img.dataset.testid = 'd-photo'; img.src = d.photo.file; img.alt = nm(i); img.decoding = 'async'; pb.append(img);
      const cr = el('div', 'credit'); cr.dataset.testid = 'd-credit'; cr.append(`${t.photo}: ${d.photo.author} · ${d.photo.license} · `); const ca = el('a', '', 'Wikimedia Commons'); ca.href = 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(d.photo.commons.replace(/ /g, '_')); ca.target = '_blank'; ca.rel = 'noopener'; cr.append(ca); pb.append(cr); }
      const p = el('p', '', d.intro[lang]); p.dataset.testid = 'd-intro'; rich.append(p);
      rich.append(el('h4', '', t.spots)); const ul = el('ul');
      for (const s of d.spots) { const li = el('li', '', s.name[lang]); li.dataset.testid = 'd-spot'; li.onclick = () => { map.flyTo({ center: s.pt, zoom: Math.max(map.getZoom(), 14), padding: pad() }); }; ul.append(li); }
      rich.append(ul);
      const src = el('div', 'src'); src.dataset.testid = 'd-src'; src.append(t.src + '：'); for (const u of d.sources) { const a = el('a', '', new URL(u).host.replace(/^www\./, '')); a.href = u; a.target = '_blank'; a.rel = 'noopener'; src.append(a); } rich.append(src);
    };
    if (details) fill(details.get(id)); else detP.then(m => fill(m.get(id)));
    $('detail').hidden = false; $('detail').scrollTop = 0;
    map.setFilter('sel', ['==', ['get', 'id'], id]);
    if (location.hash !== '#/i/' + id) history.replaceState(null, '', '#/i/' + id);
  }
  function close() { cur = null; $('detail').hidden = true; if (map.getLayer('sel')) map.setFilter('sel', ['==', ['get', 'id'], '']); if (location.hash) history.replaceState(null, '', location.pathname + location.search); }
  $('close').onclick = close;
  addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('results').children.length) { $('results').innerHTML = ''; return; } close(); } });
  function route() { const m = /^#\/i\/([a-z0-9-]+)$/.exec(location.hash); if (m && byId.has(m[1])) { open(m[1]); flyTo(m[1], false); } }
  addEventListener('hashchange', route);
  // 手机：详情面板下滑关闭
  (() => { let y0 = null; const d = $('detail'); d.addEventListener('touchstart', e => { y0 = d.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true }); d.addEventListener('touchend', e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 90) close(); y0 = null; }, { passive: true }); })();

  // ── 搜索 ──
  const norm = s => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const idx = isl.filter(i => i.name.en || i.name.zh).map(i => [i, norm(i.name.en), i.name.zh || '']);
  let sel = 0;
  function renderResults() {
    const q = norm($('q').value.trim()), ul = $('results'); ul.innerHTML = ''; sel = 0; if (!q) return;
    const hits = [];
    for (const [i, en, zh] of idx) { const s = en === q || zh === q ? 4 : en.startsWith(q) || zh.startsWith(q) ? 3 : en.split(/[\s-]+/).some(w => w.startsWith(q)) ? 2 : en.includes(q) || zh.includes(q) ? 1 : 0; if (s) hits.push([i, s]); }
    hits.sort((a, b) => b[1] - a[1] || a[0].rank - b[0].rank);
    hits.slice(0, 8).forEach(([i], k) => {
      const li = el('li'); li.dataset.testid = 'result'; li.dataset.id = i.id; if (k === 0) li.className = 'on';
      const left = el('span'); const d = el('span', 'dot'); d.style.background = color(i.score); left.append(d, nm(i)); li.append(left, el('small', '', `${i.prov} · ${i.score.toFixed(1)}`));
      li.onclick = () => pick(i.id); ul.append(li);
    });
  }
  function pick(id) { $('results').innerHTML = ''; $('q').blur(); open(id); flyTo(id); }
  $('q').addEventListener('input', renderResults);
  $('q').addEventListener('keydown', e => {
    const items = [...$('results').children]; if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[sel].className = ''; sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; items[sel].className = 'on'; }
    if (e.key === 'Enter') pick(items[sel].dataset.id);
  });

  // ── 热度榜 ──
  function renderTop() {
    const ol = $('topList'); ol.innerHTML = '';
    for (const i of top100) { const li = el('li'); li.dataset.testid = 'top-item'; li.dataset.id = i.id; const d = el('span', 'dot'); d.style.background = color(i.score); li.append(el('span', 'n', String(i.rank)), d, el('span', 'nm', nm(i)), el('span', 'sc', i.sig.arrivals > 0 ? fmtN(i.sig.arrivals) : i.score.toFixed(1))); li.onclick = () => { open(i.id); flyTo(i.id); if (mobile()) toggleTop(false); }; ol.append(li); }
  }
  function toggleTop(on) { $('top').hidden = on == null ? !$('top').hidden : !on; $('topBtn').setAttribute('aria-pressed', String(!$('top').hidden)); }
  $('topBtn').onclick = () => toggleTop();
  $('homeBtn').onclick = () => { close(); window.__isl.home(); };

  // ── 语言 ──
  function applyLang() {
    const t = L(); document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = lang === 'zh' ? '岛热 · 菲律宾海岛热度地图' : 'PH Islands · Philippine island heat map';
    $('brandName').textContent = t.brand; $('q').placeholder = t.search; $('count').textContent = t.count(isl.length);
    $('topTitle').textContent = t.top; $('topSub').textContent = t.topSub; $('topBtnText').textContent = t.topBtn; $('lang').textContent = lang === 'zh' ? 'EN' : '中';
    $('legLow').textContent = t.low; $('legHigh').textContent = t.high; $('credits').textContent = t.credit; $('homeBtn').setAttribute('aria-label', t.home);
    if (map.getLayer('lbl')) map.setLayoutProperty('lbl', 'text-field', ['get', lang === 'zh' ? 'zh' : 'en']);
    renderTop(); renderResults(); if (cur) open(cur);
  }
  $('lang').onclick = () => { lang = lang === 'zh' ? 'en' : 'zh'; applyLang(); };
  applyLang();
})();
