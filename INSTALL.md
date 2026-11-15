# 安装与配置

先选择部署方式，再执行对应章节。**个人电脑上使用 DSH Desktop，选本机模式。** 需要从浏览器或多设备访问同一套服务器文件，选云端模式。

本仓库包含画布应用和 DSH 插件 bundle。bundle 负责接线；画布应用需按下列步骤准备。当前插件 manifest 声明 DSH `0.2.1-rc.2`，MCP 包固定 `mcp-excalidraw-server@2.1.2`。安装前确认 DSH 版本；其他版本的兼容性未验证。

<a id="desktop"></a>
## A. Desktop 本机模式

这条路径无需管理员权限、云服务器、域名、nginx、证书、systemd 或登录桥。画布保存在本机工作目录；Ctrl/Cmd+S 保存到该目录，下载副本仍由「导出」执行。

### A1. 准备本机工作空间

前提：已经安装和配置 DSH Desktop，可以正常对话；本机终端可以运行 Node.js ≥20、npm 和 Git。准备目录必须长期保留。

在 macOS、Linux 的终端或 Windows PowerShell 中执行：

```bash
git clone https://github.com/zhiyaunhe-ops/dsh-excalidraw-canvas.git
cd dsh-excalidraw-canvas
npm run setup:desktop
npm run desktop:config
```

`setup:desktop` 在 `app/` 内安装锁定依赖并构建界面，也会准备字体文件，不需要全局安装 Excalidraw MCP。`desktop:config` 只输出配置，不启动服务、不修改 DSH profile。

默认输出如下；实际绝对路径以你本机输出为准：

```json
{
  "mode": "desktop",
  "desktopDirectory": "/absolute/path/dsh-excalidraw-canvas/",
  "libraryDir": "/absolute/user/home/.dsh-canvas",
  "workspaceUrl": "http://127.0.0.1:9112",
  "publicUrl": "http://127.0.0.1:9112",
  "canvasPort": 3130,
  "workspacePort": 9112
}
```

### A2. 在 Desktop 中安装并配置插件

1. 打开 **DSH Desktop 自己的插件管理器**，安装 `github:zhiyaunhe-ops/dsh-excalidraw-canvas`。
2. 打开 `canvas-session-scope` 插件条目的配置，把 A1 输出的字段填入。必须设 `mode = desktop`，`desktopDirectory` 指向刚准备好的仓库绝对路径。
3. 保存配置。插件启动本机画布和工作空间，并自动挂载名为 `excalidraw` 的 MCP 客户端。无需另外添加同名 MCP 连接。
4. 打开 <http://127.0.0.1:9112/library/>。自定义 `workspacePort` 时使用对应端口。

使用 npm 安装的普通 `dsh` CLI 不负责 Desktop profile，别用 `dsh --profile desktop ...` 初始化或改写它。Desktop 的配置与插件操作使用应用内管理器；[官方 Desktop 说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime) 解释了应用自带命令与 npm CLI 的区别。

### A3. 绑定并使用助手

1. 在本机画布库新建或打开一张图。
2. 点击编辑页「助手」，复制其中的绑定指令，发送到一个新的 DSH Desktop 对话。
3. 助手先调用 `canvas_select`，再用 `canvas_context` 确认画布 ID。之后在同一个对话中继续绘图。
4. 编辑另一张图时，使用那张图对应的另一个对话。每个会话的绑定固定，不会因为切换浏览器页而改成另一张图。

本机网页不嵌入 Desktop 登录页。助手的输入、历史和当前对话由 Desktop 保留；画布服务只负责文件保存与 MCP 同步。Desktop 停用插件或正常退出时会关闭服务，画布文件保留，下一次启动会恢复。

### A4. 本机路径与端口

| 配置 | 默认 | 作用 |
|---|---|---|
| `desktopDirectory` | 必填 | 准备好的仓库绝对路径，含 `app/node_modules` 与 `app/dist` |
| `libraryDir` | `~/.dsh-canvas` | 画布文件和会话绑定；配置自定义值时填写绝对路径 |
| `canvasPort` | `3130` | MCP 使用的本地实时画布服务 |
| `workspacePort` | `9112` | 浏览器画布库和保存 API |
| `workspaceUrl`、`publicUrl` | 本机监听地址 | Desktop 模式按 `workspacePort` 生成，以上两个字段不覆盖它 |

两个服务都监听 `127.0.0.1`。默认端口与云端安装的 `3000/9111` 分开。端口占用时先停止重复实例，或在插件配置中修改端口。

需要单独运行画布、查看启动日志时，可在准备好的仓库执行：

```bash
npm run desktop
```

它只启动本机画布，不代替 Desktop 中的 MCP 接线。**先停用 Desktop 的 `canvas-session-scope` 插件，再独立运行此命令**，否则会争用端口。Ctrl+C 停止服务。

独立命令支持 `CANVAS_LIBRARY_DIR`、`EXCALIDRAW_PORT`、`CANVAS_PORT` 环境变量；DSH Desktop 模式优先使用插件中的对应字段。`npm run desktop:config` 也读取这些环境变量，方便生成自定义配置。

### A5. 更新与移除

停用插件后，在原仓库执行 `git pull --ff-only`、`npm run setup:desktop`，再通过 Desktop 插件管理器更新 bundle 并启用。不要一边运行服务一边替换其依赖。

卸载插件会移除 DSH 接线；本机仓库及 `libraryDir` 数据目录保留。备份时复制整个 `libraryDir`，包括 `drawings/`、`.active-canvas.json`、`.assistant-bindings.json`。只复制图纸会丢失当前画布与会话映射。

<a id="cloud"></a>
## B. 云端模式

### B1. 确认环境

本节脚本面向 Ubuntu 22.04+。需要 `sudo`、Node.js ≥20、npm、pnpm、Git、Python 3、curl、nginx、certbot。

以普通运行用户登录，再按命令中的 `sudo` 提权；画布与 DSH 必须由同一个用户运行。仓库放在该用户可读写的长期目录，不能放 `/tmp` 或装完就删除。工作空间 systemd 单元会引用此目录。

安装前必须已经具备：

- 能正常对话的 DSH `web` profile：`~/.dsh/profiles/web/package.json` 已存在，模型配置已完成。
- 名为 `dsh-web.service` 的 systemd 服务，运行同一用户的 `web` profile，监听 **`127.0.0.1:8790`**，日志由 journal 保存。
- 一个解析到本机公网 IP 的域名，HTTP 80 和 HTTPS 443 可访问；或允许脚本生成 `canvas-<公网IP>.sslip.io` 域名。

本仓库不创建模型提供商配置或 `dsh-web` 服务。新建服务时，核心启动命令是 `dsh --profile web --host 127.0.0.1 --port 8790 --no-open`；systemd 还需配置正确的运行用户、工作目录和 Node/dsh PATH。已有 DSH 不要重置 profile。

安装器的助手桥当前固定使用 `web` profile、`dsh-web` 服务名和 `8790` 端口。修改一个环境变量不会同步改完这套约定；先按这里的默认值接通。

### B2. 部署画布应用

以运行 DSH 的普通用户执行：

```bash
git clone https://github.com/zhiyaunhe-ops/dsh-excalidraw-canvas.git
cd dsh-excalidraw-canvas
sudo env PATH="$PATH" ./install.sh canvas.example.com
```

将域名换成真实值；不传域名则按公网 IP 生成 sslip.io 地址。`sudo env PATH="$PATH"` 保留当前 Node/npm 路径，适用于 Node 安装在用户目录的情况。

此命令安装全局 MCP 包、实时画布 systemd 服务、nginx 站点及已有令牌访问方式、TLS 证书，然后构建并启动工作空间。输出首次访问链接；需要再次获取时执行 `sudo ./scripts/canvas-link.sh`。不要将包含令牌的访问链接写入公开文档。

默认约定：

| 组件 | 地址或路径 |
|---|---|
| 实时画布 | `127.0.0.1:3000`，服务 `excalidraw-canvas` |
| 画布工作空间 | `127.0.0.1:9111`，服务 `canvas-workspace` |
| DSH web | `127.0.0.1:8790`，服务 `dsh-web` |
| 登录桥 | `127.0.0.1:9110`，服务 `dsh-embed-login` |
| 画布及绑定 | `/var/www/canvas-library/` |
| nginx 站点 | `/etc/nginx/sites-available/excalidraw-canvas.conf`；兼容旧的无后缀文件 |
| 外部地址 | `https://<域名>/library/`、`/canvas/<id>` |

如需改实时画布端口，B2/B3 都传入同一个 `EXCALIDRAW_PORT`。`9111/9110/8790` 按上述默认约定部署。

### B3. 连接 DSH MCP

仍以普通运行用户执行：

```bash
./scripts/install-dsh-mcp.sh web
```

脚本在 profile 中补齐 `@deepseek-ai/dsh-mcp-client@0.2.1-rc.2`，追加 MCP 配置，再校验合成配置。若存在 `dsh-web` systemd 服务，会自动重启它使连接生效。这一步会中断当时的 DSH 工作，选没有任务运行时执行。

Excalidraw MCP 的配置必须保持 `serverName: excalidraw`、`EXCALIDRAW_NO_AUTOSTART: "1"`，并将 `EXPRESS_SERVER_URL` 指到 B2 的实时画布地址。实时画布由 systemd 运行，MCP 只连接它。

### B4. 选择插件接线方式

**方式一：直接使用仓库源码。** 适合自己部署、自己维护：

```bash
sudo env PATH="$PATH" ./dsh-embed/install.sh
```

脚本安装登录桥和源码插件、迁移已有画布会话，并热加载画布范围插件。它使用 `CANVAS_PLUGIN_MODE=local` 默认值；这里的 `local` 指“源码接线”，不是 Desktop 模式。

**方式二：通过插件管理器安装 bundle。** 适合按公开插件方式管理：

```bash
dsh plugin --profile web add github:zhiyaunhe-ops/dsh-excalidraw-canvas
```

也可以在 DSH web 的插件管理器中输入同一个 GitHub 安装地址。然后为 `canvas-session-scope` 配置：

```json
{
  "mode": "cloud",
  "libraryDir": "/var/www/canvas-library",
  "workspaceUrl": "http://127.0.0.1:9111",
  "publicUrl": "https://canvas.example.com"
}
```

云端插件与工作空间运行在同一主机，`libraryDir` 指向同一个实际目录。再安装助手桥：

```bash
sudo env PATH="$PATH" CANVAS_PLUGIN_MODE=bundle ./dsh-embed/install.sh
```

bundle 模式不会再安装一份源码插件。**两种方式二选一**。从已有源码接线迁移到 bundle 前，备份 profile patch，移除旧的 `canvas-session`、`canvas-session-scope` 插入条目和源码 `dsh-canvas-session` 软链，再安装 bundle；保留图纸、DSH 会话和 `.assistant-bindings.json`。

### B5. 完成判据

部署后检查以下地址与状态，不需要重新创建图纸：

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:9111/workspace/api/documents
curl -fsS http://127.0.0.1:9110/healthz
systemctl is-active excalidraw-canvas canvas-workspace dsh-web dsh-embed-login
```

实时画布端口若已改动，第一条使用对应端口。四个服务应为 `active`，文档接口应包含 `documents` 和 `activeId`。

由使用者打开首次访问链接，进入 `/library/`：新建图纸后进入独立编辑页，修改并 Ctrl/Cmd+S，再刷新确认保留；点击「助手」确认打开对应对话，调用 `canvas_context` 后进行一次绘图。视觉、布局和真实浏览器操作由使用者确认。

### B6. 升级、备份与移除

更新仓库后，只更新工作空间：

```bash
git pull --ff-only
sudo env PATH="$PATH" ./scripts/install-workspace.sh
```

该命令构建并重启工作空间，不重启实时画布或 DSH。首次迁移会备份画布库，站点配置修改前也会备份；日常备份仍需自行保存整个 `/var/www/canvas-library/`。

源码插件升级再执行 `sudo env PATH="$PATH" ./scripts/install-session-scope.sh`，它热加载上下文和工具绑定，不重启 DSH。bundle 接线通过插件管理器更新 bundle。不要为日常升级重跑根目录 `install.sh`，它会重建站点并重启实时画布。

卸载服务与助手桥：

```bash
sudo ./uninstall.sh --with-embed
```

画布数据、MCP npm 包、证书及 DSH profile 配置保留。通过插件管理器移除 bundle，或从 profile patch 移除源码插件和 `mcp-excalidraw` 条目。不会删除你的图纸或聊天记录。

## 常见配置问题

| 现象 | 处理 |
|---|---|
| Desktop 页面打不开 | 确认插件 `mode=desktop`、仓库完成 `setup:desktop`、`desktopDirectory` 仍存在；查看插件启动日志及本机端口 |
| Desktop 报端口占用 | 结束独立的 `npm run desktop`；每套端口只运行一个实例 |
| Desktop 安装器拒绝 DSH 版本 | 对照插件 manifest 的 `engines.dsh`；不要用 npm CLI 强行初始化 Desktop profile |
| 助手没有 Excalidraw 工具 | Desktop 查看插件的 MCP 启动日志；云端确认 B3 成功且 `dsh-web` 已重启 |
| 工具提示会话未绑定 | 使用 `canvas_list` 获取 ID，再 `canvas_select`；Desktop 也可复制画布页的绑定指令 |
| 工具提示目标与当前画布不一致 | 打开绑定画布并点击「让助手连接这张画布」；另一张图使用另一个对话 |
| 云端助手打不开 | 确认同源 `/dsh/` 代理、`dsh-web:8790` 和登录桥 `9110` 均可用；点「重新连接」 |
| 云端安装显示 profile 未初始化 | 先完成 B1，以运行 DSH 的同一个用户执行 B3/B4 |
| 源码接线和 bundle 冲突 | 按 B4 选一种并清理另一种的插件条目，保留画布与绑定文件 |
| 保存显示冲突 | 先保留为副本，或重新载入工作空间版本，避免覆盖别的窗口或助手的修改 |

## 给配置 agent 的执行顺序

1. 确认用户选择 Desktop 或云端，读取当前 DSH 版本和已有插件接线，保留已有数据与模型配置。
2. Desktop 按 A1 → A2 → A3；云端按 B1 → B2 → B3 → B4。不要混用 Desktop profile 和 web profile，也不要同时安装两套范围插件。
3. 检查实际服务、路径和端口，报告已完成的功能检查；视觉效果交给用户确认。
4. 不具备 Desktop 或公网 DNS/TLS 环境时，明确说明未验证部分，不把源码构建通过等同于真实桌面或公网安装完成。
