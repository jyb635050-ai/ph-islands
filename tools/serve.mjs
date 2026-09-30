// 本地预览：站点挂在 /ph-islands/（和 GitHub Pages 一样）。用法：node tools/serve.mjs [端口，默认 4490]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), PORT = +(process.argv[2] || 4490), SUB = '/ph-islands/';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.pbf': 'application/x-protobuf' };
http.createServer((q, s) => {
  const u = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (!u.startsWith(SUB)) { s.writeHead(302, { location: SUB }); return s.end(); }
  let f = path.join(ROOT, u.slice(SUB.length)); if (!f.startsWith(ROOT)) { s.writeHead(403); return s.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end('404'); }
  s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(s);
}).listen(PORT, () => console.log(`http://127.0.0.1:${PORT}${SUB}`));
