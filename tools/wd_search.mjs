// 按名字搜 Wikidata 条目并取坐标：node tools/wd_search.mjs "名字1" "名字2" …（只打印，供人工挑景点）
const UA = 'PHIslands-build/1.0 (github.com/jyb635050-ai/ph-islands)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function J(u) { for (let k = 0; k < 8; k++) { const r = await fetch(u, { headers: { 'user-agent': UA } }).catch(() => null); if (r && r.ok) { const t = await r.text(); try { return JSON.parse(t); } catch (e) { } } await sleep(3000 * (k + 1)); } throw new Error('fail'); }
for (const q of process.argv.slice(2)) {
  const s = await J(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&limit=5&format=json`);
  const ids = (s.search || []).map(x => x.id);
  if (!ids.length) { console.log(`${q} → 无`); continue; }
  const e = await J(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels|claims|descriptions&languages=en|zh|zh-hans&format=json`);
  console.log(`${q} → ` + ids.map(id => { const x = e.entities[id]; const c = x.claims?.P625?.[0]?.mainsnak?.datavalue?.value; return `${id}「${x.labels?.en?.value}」${x.labels?.['zh-hans']?.value || x.labels?.zh?.value || ''} ${c ? c.longitude.toFixed(4) + ',' + c.latitude.toFixed(4) : '无坐标'} ${(x.descriptions?.en?.value || '').slice(0, 40)}`; }).join(' | '));
  await sleep(1200);
}
