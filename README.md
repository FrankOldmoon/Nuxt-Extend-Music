# 私人音乐库 · Nuxt Music Module

Navidrome 风格的私人音乐库，以 Nuxt 4 层模块的形式挂载到宿主后台项目，目录固定为 `modules/music`。

设计与同仓库的 `modules/library` 保持一致：**零新增依赖、没有 `package.json`**，标签解析、流式传输、播放器全部自己实现。唯一的例外是「格式转换」——它把 ffmpeg.wasm 放在浏览器里按需从 CDN 加载，服务器不安装任何东西。

## 特性

### 目录与浏览
- 首页聚合：最近添加、最近播放、听得最多、新入库专辑、随机专辑、歌单
- 全部歌曲（搜索 / 排序 / 分页）、专辑网格与专辑页、艺术家网格与艺术家页、流派、统一搜索（歌曲 + 专辑 + 艺术家）
- 搜索走 SQL `ilike` + 对关联艺术家/专辑名的 `exists`，中文标题无需分词器也能正确匹配

### 标签解析（全部自己实现，无第三方库）
| 容器 | 读取内容 |
|---|---|
| MP3 | ID3v2.2 / 2.3 / 2.4（含去同步、扩展头、UTF-8/UTF-16 编码、多值字段、`(17)` 数字流派），ID3v1 兜底；时长取 Xing/Info/VBRI 帧数，缺失时按 CBR 估算 |
| FLAC | STREAMINFO（采样率/声道/位深/总采样数）、Vorbis comment、PICTURE 块 |
| M4A / AAC | `moov.mvhd` 时长、`udta.meta.ilst` 文本与 `trkn`/`disk`/`covr` 等二进制项 |
| OGG / Opus | Vorbis comment（`METADATA_BLOCK_PICTURE` 内嵌封面）、末页 granule 求时长（Opus 恒按 48 kHz） |

四种容器都输出**时长、内嵌封面、内嵌歌词**；封面会按内容哈希去重，并在专辑还没有封面时提升为专辑封面。

### 播放
- 队列、上一首/下一首、拖动进度、音量/静音、随机、三种循环（不循环 / 列表 / 单曲）
- 音频流支持 **HTTP Range（206）**——没有它浏览器就不让你拖动进度
- 系统级媒体键与锁屏控制（Media Session）
- 播放计数只在**实际听满 75%**（长曲封顶 240 秒）时才 +1，跳过不算

### 无需登录也能用
首页、全部歌曲、专辑、艺术家、流派、搜索、公开歌单，以及**所有公开曲目**都可以匿名访问与播放。上传、编辑、删除、歌单与收藏需要登录。宿主没有全局路由中间件（页面默认公开），因此这是靠「不给页面加 auth 中间件 + 接口用可空的 `getSessionUser`」实现的。

### 收藏、歌单、歌词
- 收藏（星标）歌曲 / 专辑 / 艺术家
- 歌单：公开或私有、手动排序、加曲/移除；公开歌单匿名也能看到
- 歌词：优先内嵌（ID3 USLT / LYRICS），回退到音频同目录同名 `.lrc`；带时间轴的会逐行高亮并自动滚动，点某行可跳转

### 浏览器端格式转换
把 FLAC / M4A 等转成 MP3 / M4A / Opus / WAV，便于在不支持该编码的浏览器里播放或直接下载。转换全部发生在**用户浏览器的 Web Worker 里**（ffmpeg.wasm）：

- 服务器零依赖、零计算，也不保存转换产物；
- 转码器首次使用时才从 CDN 下载（约 30 MB），没人转换就没人下载；
- 代价是必须先下载完整个文件，**不适合边下边播的流式转码**，且大文件可能撞上 wasm 的内存上限；
- 内网/离线部署可把 CDN 指向自建副本（见下方配置）。

### 上传与管理
网页上传（多文件、拖放、进度条、逐文件结果）、编辑标签与可见性、删除（软删除）、批量软删/恢复、重读标签。重复上传同一份音频会被内容哈希识别并跳过，不占额外空间。

## 快速开始

模块通过宿主的环境变量自动发现（宿主扫描 `modules/*`，按 `<NAME>_ENABLED=true` 挂载），**不需要改动宿主任何代码**：

```bash
MUSIC_ENABLED=true npm run dev
```

### 关于站点首页

启用后，模块会把站点根 `/` 换成音乐首页（与 `modules/library` 的做法一致），自己的页面则在 `/music/**`。

两者同时启用时，**音乐接管 `/` 是确定性的**，不取决于目录遍历顺序：宿主的 `extends` 数组顺序来自 `readdirSync`，如果两个模块都从 `pages:extend` 抢占根路由，谁赢是随机的；因此本模块改在 `pages:resolved`（在所有 `pages:extend` 之后）接管。

想让 `/` 留给宿主或留给 library：

```bash
MUSIC_TAKE_SITE_ROOT=false MUSIC_ENABLED=true npm run dev
```

（保持默认时，library 的页面依然在 `/library/**` 正常访问。）

### 数据库

首次启动自动建表（幂等 DDL，每次启动都可安全执行）。8 张表全部使用 `mus_` 前缀，与宿主其他数据互不干扰。

## 页面一览

| 路径 | 说明 |
|---|---|
| `/` 与 `/music` | 音乐首页（匿名可见） |
| `/music/tracks` | 全部歌曲（搜索 / 排序 / 分页） |
| `/music/albums`、`/music/albums/:id` | 专辑网格、专辑详情 |
| `/music/artists`、`/music/artists/:id` | 艺术家网格、艺术家详情 |
| `/music/genres` | 流派（左选右看，单页完成） |
| `/music/playlists`、`/music/playlists/:id` | 歌单、歌单详情 |
| `/music/favorites` | 我的收藏（歌曲 / 专辑 / 艺术家） |
| `/music/search` | 统一搜索 |

## 目录结构

```
modules/music/
├── index.ts                     # 模块入口：接管站点根（pages:resolved）
├── nuxt.config.ts               # i18n 语言包 + ffmpeg CDN 的 public runtimeConfig
├── app/
│   ├── layouts/music.vue        # 外壳：分区导航 + 播放条 + 队列/歌词面板
│   ├── composables/
│   │   ├── useMusic.ts          # 客户端 DTO 类型 + 显示与请求辅助
│   │   ├── useMusicPlayer.ts    # 全局播放器（单例，切页面不断播）
│   │   └── useAudioTranscode.ts # ffmpeg.wasm 加载与转码
│   ├── utils/
│   │   ├── transcode.ts         # 目标格式表、ffmpeg 参数、浏览器能力探测
│   │   └── lyrics.ts            # LRC 解析与当前行定位
│   ├── components/music/        # 10 个组件（封面、专辑卡、曲目列表、播放条、…）
│   └── pages/music/             # 11 个页面
├── server/
│   ├── plugins/music.ts         # 启动：写入配置项 + 建表
│   ├── database/{schema,migrate}.ts
│   ├── utils/                   # 13 个工具（见下）
│   └── api/music/               # 27 个接口
├── i18n/locales/{en,zh,zh-TW}.json
└── test/                        # 单元测试与合成音频 fixture
```

服务端工具：`audioMeta`（格式嗅探与分发）、`tagId3` / `tagFlac` / `tagMp4` / `tagOgg` / `vorbis`（四种容器的解析）、`store`（文件与封面落盘）、`stream`（Range 解析）、`catalogue`（可见性、实体归并、计数、DTO 组装）、`import`（导入/重扫/软删）、`playlists`、`lyrics`、`http`。

## 数据模型

| 表 | 说明 |
|---|---|
| `mus_artists` | 艺术家 |
| `mus_albums` | 专辑，按 (名称, 专辑艺术家) 唯一——这样合辑不会按参与者拆成一堆专辑 |
| `mus_genres` | 扁平流派表（按 slug 去重） |
| `mus_tracks` | 曲目（一句 audio 文件一行），含 `hash`（内容哈希）、`is_public`、`is_active`、`deleted_at` |
| `mus_playlists` / `mus_playlist_tracks` | 歌单与曲目关系（后者带手动顺序） |
| `mus_stars` | 每用户的星标（`entity_type` + `entity_id`） |
| `mus_play_history` | 只增的播放日志，供「最近播放」 |

没有转码缓存表：转换发生在浏览器，服务器不持有转换产物。

## 接口一览

**曲目** `GET/POST /api/music/tracks`（列表 / 无）、`GET/PUT/DELETE /api/music/tracks/:id`、`POST /api/music/tracks/upload`（multipart）、`POST /api/music/tracks/batch`（软删/恢复/重扫）、`GET /api/music/tracks/:id/stream`（Range）、`POST /api/music/tracks/:id/play`

**专辑** `GET /api/music/albums`、`GET/PUT/DELETE /api/music/albums/:id`（重命名会合并到同名专辑）

**艺术家** `GET /api/music/artists`、`GET/PUT /api/music/artists/:id`（重命名合并）

**流派** `GET /api/music/genres`、`GET /api/music/genres/:id`

**聚合与搜索** `GET /api/music/home`、`GET /api/music/search`

**收藏** `GET /api/music/stars`、`POST /api/music/stars`（不传 `starred` 即切换）

**歌单** `GET/POST /api/music/playlists`、`GET/PUT/DELETE /api/music/playlists/:id`、`POST /api/music/playlists/:id/tracks`（`add` / `remove` / `order`）

## 设计要点

- **可见性是一条规则**：`deleted_at IS NULL AND is_active` 且（公开 或 属于当前用户），管理员不受限。专辑/艺术家/流派只有在**至少有一首可见曲目**时才被列出，所以匿名访客不会点进一个空空如也的艺术家页。
- **实体归并**：艺术家按名称精确匹配（大小写敏感）查找后复用；专辑按 (名称, 专辑艺术家) 复用。重命名会迁移曲目并回收空行，因此修一个错别字就能把被拆开的艺术家重新合起来。
- **导入幂等**：以音频内容哈希为键，重复上传直接返回既有曲目。
- **单调的层位约定**：`components/music/X.vue` 在 Nuxt 里叫 `<MusicX>`（Nuxt 会把目录名并入组件名），所以模板里统一写 `<MusicTrackList>` 这一形式——与 library 模块的 `<LibraryBookCard>` 一致。
- **MPEG 帧头的一个坑**：比特率表的键必须是帧头里的 *layer bits*，它与层号是反的（`3` = Layer I、`1` = Layer III）。用层号去索引会拿 Layer I 的表去算 Layer III 文件，时长会差一倍多。
- **M4A 时长口径**：`mvhd` 把 AAC 编码器预填充（约 2112 采样，22.05 kHz 下 ≈ 96 ms）算在内，比 `afinfo` 或浏览器报的「可听时长」长约 0.1 秒。要精确需要解析 `edts/elst`，这里刻意不做：播放开始后会用媒体元素自己的时长覆盖这个估值。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `music.enabled` | `true` | 关掉后启动插件跳过建表（环境变量未开时层根本不会挂载） |
| `music.maxFileSizeMB` | `100` | 单个上传文件大小上限 |
| `music.ffmpegBase` | `https://unpkg.com` | 浏览器加载 ffmpeg.wasm 的 CDN 基址，内网请指向自建副本 |

另有 public runtimeConfig `musicFfmpegBase`（可用 `NUXT_PUBLIC_MUSIC_FFMPEG_BASE` 覆盖），前端优先使用它。

## 对宿主的依赖（接入契约）

模块从宿主 `server/` 与 `app/` 引入以下内容。把模块挂到别的宿主时，这些是必须存在的：

- `server/database`：`db`、`pool`
- `server/database/schema.ts`：`files`、`configs` 表
- `server/utils/auth`：`requireUser`、`getSessionUser`
- `server/utils/configs`：`getConfigValue`
- `server/utils/fileStorage`：`buildStoragePath`、`calculateHash`、`saveToStorage`、`getAbsolutePath`
- 前端自动导入：`useAuth`、`useToast`、`useI18n`、`cGet` / `cPost` / `cPut` / `cDelete`（宿主 `app/utils/network.ts`）、`extractErrorMessage`、`formatBytes`
- Nuxt UI v4 组件（`UModal` / `UDropdownMenu` / `USelect` / …）与 Tailwind 4 语义色板

音频文件保存在宿主统一的 `storage/` 目录里，按内容哈希命名，且**只**通过本模块的鉴权接口读取，不经过宿主的公开文件路由。

## 开发

```bash
# 单元测试（标签解析、转码词汇表、歌词解析；含按字节构造的合成音频 fixture）
node_modules/.bin/vitest run --config modules/music/vitest.config.ts

# 静态检查（--no-ignore 是必需的：宿主 .gitignore 忽略了 modules/）
node_modules/.bin/eslint --no-ignore modules/music

# 类型检查
MUSIC_ENABLED=true node_modules/.bin/nuxt typecheck
```

## 代码约定

- 注释用英文（与宿主一致），面向「为什么这么做」，而不是复述代码
- 每个功能一个小文件，纯逻辑（解析、拼装、计算）与副作用（数据库、网络）分开，纯逻辑必须可单测
- 不引入 npm 依赖；需要外部能力时优先用浏览器或系统已有能力，并显式降级

## 已知限制

- **不做流式转码**：转换在浏览器完成，必须先下载完整文件（见上文取舍）。服务器上不装 ffmpeg 是刻意选择。
- **AAC 预填充**导致的 ~0.1 秒时长偏差（见设计要点）。
- **没有后台 CRUD 注册**：library 模块把表注册进了宿主的通用后台，本模块没有——它自带上传/编辑界面，八张表都在后台再镜像一遍收益不大。日后要加是一次性的改动（`registerDrizzleSchema` + `registerDashboardTable`）。
- **界面未做批量勾选**（接口已支持批量软删/恢复）；软删除的曲目在列表里隐藏，没有独立的回收站页面；「重读标签」目前只有接口。
- 播客、网络电台、Subsonic API 兼容、Last.fm 打点、ReplayGain/无缝播放均未实现。

## 许可

本仓库未声明许可证（宿主项目同样没有）。如需对外分发，请先补上 `LICENSE`。
