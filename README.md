<p align="center">
  <img src="icon.svg" alt="dsh-kindle-shelf logo" width="84" height="84">
</p>

<h1 align="center">dsh-kindle-shelf</h1>

<p align="center">Kindle 书库工作台 · DeepSeek Harness 插件</p>

<p align="center">
  <a href="https://github.com/morehao/dsh-kindle-shelf/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/morehao/dsh-kindle-shelf/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@morehao/dsh-kindle-shelf"><img alt="npm" src="https://img.shields.io/npm/v/@morehao/dsh-kindle-shelf.svg"></a>
</p>

Kindle 中国区退出后，「买书 → 传书」这条路断了。这个插件把「**本机找书 → 转成 Kindle 格式 → 传进 Kindle → 清理旧书**」收进 DSH 的一个工作台里，网页上点几下就完成。

不是 calibre 替代品：不建书库数据库、不编辑元数据、不做阅读器，只保留三条主线。

## 为什么需要它

先说一个决定架构的事实：**Kindle 原生不监听任何端口**，没有 SMB / FTP / HTTP 服务。所以「电脑主动访问 Kindle」只在越狱设备上成立：

| 你的 Kindle | 能做什么 | 用哪个页 |
|---|---|---|
| 未越狱 | Mac 起一个只读网页，Kindle 用自带浏览器来下载 | **传送** |
| 越狱 + SSH（USBNetwork / KUAL） | SFTP 列出 / 上传 / 删除 / 回传设备上的书 | **Kindle** |

两条路可以同时用：先转换，再推送；越狱了就绕过浏览器直接传。

## 功能

### 书库

扫描你配置的书籍目录（可多个、递归），EPUB 直接解析标题 / 作者 / 封面，其它格式用文件名展示。支持搜索、按格式筛选、多选。

选中的书可以：

- **转 MOBI**（默认，兼容性最好）：`ebook-convert --mobi-file-type new`
- **转 AZW3**（KF8，排版更好）：`ebook-convert --output-profile kindle_pw3`
- **加入推送队列**

转换任务串行执行，实时显示百分比；产物默认写到 `~/Documents/Books/kindle`，并自动出现在书库里（不用手动刷新目录）。

### 传送

插件内置一个只读的局域网 HTTP 服务（默认 `:8180`）：

- Kindle → 菜单 → **体验版网页浏览器** → 打开面板上显示的地址
- 点书名下载；下载完出现在书库（没出现时用「本机 → 文档」同步一次）
- 下载名一律 ASCII slug，扩展名统一呈现为 `.azw`——Kindle 浏览器只认 `.AZW / .PRC / .MOBI / .TXT`，AZW3 与 AZW 同为 KF8 容器，换名不动字节

服务只暴露「推送队列」里登记过的文件，不开放任意路径。

### Kindle（越狱设备）

配置 SSH 地址与凭据后：

- 列出 Kindle 书库（`/mnt/us/documents`）
- 从书库上传选中的书
- 删除设备上的书
- 连接状态、错误原因就地展示

> 未越狱设备不暴露 SSH，这里会明确提示「未配置 / 连不上」，不会假装能用。

## 安装

需要 DeepSeek Harness `0.2.1-rc.3` 以上、Node 22.20+ / 24+，以及本机 calibre（转换用）。

```bash
# 装进 web profile
dsh plugin --profile web add @morehao/dsh-kindle-shelf
```

然后在 profile 的 `dsh.profile.bundles` 里登记 `@morehao/dsh-kindle-shelf`（与其它插件一致），重启 DSH。侧栏会出现「Kindle」入口。

本地开发：

```bash
git clone git@github.com:morehao/dsh-kindle-shelf.git
cd dsh-kindle-shelf
npm install
npm run build
dsh plugin --profile web add "link:$PWD"
```

## 首次使用

1. **设置** → 填「书库目录」（每行一个绝对路径）→ 保存
2. **设置** → 确认 calibre 目录（默认 `/Applications/calibre.app/Contents/MacOS`）
3. **书库** → 选书 → 转 MOBI
4. **传送** → 确认服务运行中 → Kindle 浏览器打开地址下载
5. （可选）**Kindle** → 填 SSH 地址 / 端口 / root 密码或私钥 → 连接

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `libraryDirs` | `[]` | 书库目录，递归扫描 |
| `outputDir` | `~/Documents/Books/kindle` | 转换产物目录，同时纳入书库扫描 |
| `calibreDir` | `/Applications/calibre.app/Contents/MacOS` | 含 `ebook-convert` / `ebook-meta` |
| `defaultFormat` | `mobi` | `mobi` / `azw3` |
| `push.port` | `8180` | 局域网推送端口，改后自动重启 |
| `push.bind` | `0.0.0.0` | 监听地址 |
| `kindle.host` / `port` / `user` | 空 / `22` / `root` | SSH 连接信息 |
| `kindle.documentsPath` | `/mnt/us/documents` | Kindle 书库路径 |
| `kindle.password` / `keyPath` | 空 | 二选一；密码/私钥不通过 HTTP 明文回传 |

设置落在 `$DSH_HOME/kindle/settings.json`（0600），推送队列落在同目录 `state.json`。

## HTTP API

前缀 `/api/morehao/kindle-shelf`，除封面外要求请求头 `x-dsh-kindle-shelf: 1`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/state` | 汇总状态：设置 / 书库 / 任务 / 队列 / 推送 / Kindle |
| GET | `/library` | 扫描书库 |
| GET | `/cover?path=` | 封面图 |
| POST | `/convert` | `{ paths, format }` 入队转换 |
| GET | `/jobs` / POST `/jobs/cancel` | 任务列表 / 取消 |
| POST | `/queue` / DELETE `/queue/:id` | 推送队列增删 |
| POST | `/push/start` / `/push/stop` | 启停局域网服务 |
| GET | `/kindle` | 连接状态 + 设备书单 |
| POST | `/kindle/connect` / `upload` / `delete` / `download` | 设备操作 |
| GET / POST | `/settings` | 读写设置 |

## 进一步阅读

- [传输与转换方案](docs/transport-and-conversion.md)：三种传输后端（局域网推送 / 越狱 SFTP / USB 直连）的对比与状态、Kindle 端为什么必须手动下载、calibre 依赖边界与去 calibre 的三条路线。

## 已知限制

- **未越狱 Kindle 不能被读取或删除**，只能单向推送——这是设备能力决定的，不是插件缺陷。
- 转换依赖本机 calibre；EPUB 解析是轻量实现（container → OPF → 封面），极少数结构异常的 EPUB 可能取不到封面，不影响转换。
- Kindle 浏览器对中文文件名兼容性差，下载名是 ASCII slug；书名仍通过 `Content-Disposition: filename*` 保留。
- SSH 后端针对 Kindle 的老 dropbear 放宽了算法（`group1-sha1` / `aes-cbc` 等）；如果你的设备只支持更老的算法，需要自行调整。
- 推送服务在局域网内无鉴权，只读且只暴露队列文件；不要在不可信网络长期开启。

## 开发

```bash
npm run build          # host（tsup）+ client（esbuild）
npm run typecheck      # host 类型
npm run check:types    # client 类型
npm test               # node:test
```

结构：

```
src/
  index.ts            # cordis 插件入口（host）
  state.ts            # settings.json / state.json
  host/
    routes.ts         # /api/morehao/kindle-shelf/*
    library.ts        # 书库扫描 + 封面缓存
    epub.ts           # 轻量 EPUB 解析（fflate）
    calibre.ts        # ebook-convert / ebook-meta
    convert.ts        # 转换队列
    push.ts           # 局域网推送服务
    sftp.ts           # 越狱 Kindle 的 SSH/SFTP
client/
  index.ts            # slot 注册 + 轮询
  views.ts            # 书库 / 传送 / Kindle / 设置
```

## License

MIT
