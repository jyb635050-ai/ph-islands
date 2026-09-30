# PROGRESS — PH Islands 海岛热度地图

## 开工回执（2026-09-29）
- 目标：7,807 座菲律宾岛的热度地图，点岛出面积/省/热度来由，前 100 名有介绍/景点/照片；规格＝tools/accept.mjs 文件头
- 任务 0 核对：判卷 SHA256 b1169030… 一致；gh 已登录 jyb635050-ai；`--only data` 空项目 0/9、退出码 1
- 顺序：1 数据管线（tools/build.mjs）→ 2 前 100 名内容 → 3 网站 → 4 上线
- 最大风险：①岛名/维基匹配质量决定热门性检查；②全量几何体积与首屏 6 MB、帧率；③接口 429 限流拖时间

## 进度
- [x] 任务 0
- [x] 任务 1 数据管线 `node tools/build.mjs`（各阶段缓存在 tools/.cache/）
  - 7,807 座、295,748 km²；岛名＝OSM place 外框重合度匹配（点用点在面内）＋ Wikidata 岛坐标补名；wd 只留 Wikidata 上是岛的条目
  - 渲染用矢量瓦片 data/tiles（z0–12，7,082 个，5.2 MB，geojson-vt＋vt-pbf 装在 tools/node_modules）＋ data/tiles/index.json 存在清单（海面不发请求，避免 404 报错）
  - 单岛最高精度几何按 1° 格存 data/geom/<格>.json（geom()/at() 用）
  - 权重沿用管理者试算值；`--only data,geo,signals` 除 names/details 外全绿
  - 坑：名次排序要用写进文件的取整面积，否则同分小岛顺序对不上（已修）
- [x] 任务 2 内容：tools/content/p1–p5.json（人工写）→ `node tools/content_build.mjs` 合成 data/details.json
  - 景点只写编号＋中文名，英文名与坐标从 OSM/Wikidata 原始记录回填；自检同判卷标准＋“介绍里的数字必须在维基原文出现”
  - 434 个景点全部对上；5 座小岛真实景点不足 3 个 → BLOCKED.md
  - [ ] 照片：tools/photos_fetch.mjs sheets → 人工看联络表 → photo_pick.json → pick
- [ ] 任务 3 网站（index.html + css/app.css + js/app.js 已可用，待全量判卷）
- [ ] 任务 4 上线

## 建议偏离记录
- 首屏 6 MB 的建议：用矢量瓦片而不是分级 GeoJSON——MapLibre 自带按需加载，首屏实测 3.48 MB
- 本地预览不走 D:\blender\.claude\launch.json（白名单外），用 tools/shot.mjs 无头截图
