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
  - [x] 照片：sheets → 逐张目检 10 张联络表＋重搜表 → photo_pick.json → pick；86 座有图，14 座错图宁缺（BLOCKED.md）
- [x] 任务 3 网站：本地全量 42/43，唯一红项 data.details＝5 座景点不足＋14 座缺图（待裁决）
- [x] 任务 4 上线：仓库 jyb635050-ai/ph-islands，Pages main 根目录；`--url` 31/31；`--prove` 17/17 抓到、退出码 1；判卷指纹未变
  - 坑：线上点开详情时照片还在下载 → 就绪后空闲按热度预取前 100 名照片（98fa35a）

- [x] 任务 5 改版：领导 2026-10-01「按实际客流量排名」
  - tools/arrivals/records.json：31 条 2023–2025 官方客流（DOT／地方旅游办，新闻原文原句），每条 src＋quote；判卷 signals.arrivals 逐条打开原网页核原句
  - build.mjs 阶段 K：每个住宿设施归到最具体的记录区域（岛＜市＜省＜大区），记录剩余量按设施数分给各岛，标「估算」；岛级记录（长滩、锡亚高）整数给、标「官方」
  - 得分：有客流 50–100（对数），无客流 0.499×网络热度指数（≤49.9）垫底；136 座岛有客流，合计 29,777,464
  - 详情加 d-arrivals（人数、年份、官方/估算、出处链接）；精写范围＝原 100 座＋年游客 ≥5 万（补萨马尔、卡坦端内斯、吉马拉斯、塔利库德）→ 104 座
  - 判卷同步改版，新指纹 SHA256 12eeb1b1c7a0f60859fd41fd84fe90b28cbdfcaae69bd5d129c068c18d5cb93d（--prove 18/18 抓到），加 data.arrivals／signals.arrivals／d-arrivals 检查和「客流数字篡改」破坏
  - 上线 5a72c97＋fd7ce02（坑：详情原来按 rank≤100 才显示，改排名后帕马利坎等掉出前 100 就不显示了，改为有详情就显示）；本地全量只剩 data.details 红（缺图/景点不足，见 BLOCKED）；`--url` 32/32
  - 局限见 BLOCKED.md 第 4 节

## 建议偏离记录
- 首屏 6 MB 的建议：用矢量瓦片而不是分级 GeoJSON——MapLibre 自带按需加载，首屏实测 3.48 MB
- 本地预览不走 D:\blender\.claude\launch.json（白名单外），用 tools/shot.mjs 无头截图
