# dsh-excalidraw-canvas

在 DeepSeek Harness 中使用 Excalidraw：管理画布、自动保存，多位 agent 各自在后台绘图，互不占用。

支持两种安装方式。个人电脑使用 **Desktop 本机模式**；需要浏览器或多设备访问时使用 **云端模式**。完整配置步骤见 **[INSTALL.md](INSTALL.md)**。

| | Desktop 本机 | 云端服务器 |
|---|---|---|
| 适用场景 | 在自己的电脑上使用 DSH Desktop | 浏览器、手机、多设备访问 |
| 启动方式 | 插件启动本地画布与保存服务，并连接 MCP | systemd 管理服务，nginx 提供网站 |
| 保存位置 | 默认 `~/.dsh-canvas/drawings/` | `/var/www/canvas-library/drawings/` |
| 助手 | DSH Desktop 原有对话，首次明确绑定画布 | 编辑页中的常驻 DSH 对话侧栏 |
| 环境 | Node.js、Git、DSH Desktop | Ubuntu、Node.js、DSH web、nginx、certbot |
| 域名、证书、登录桥 | 无需配置 | 安装脚本配置 |

## Desktop 快速开始

先在本机准备工作空间：

```bash
git clone https://github.com/zhiyaunhe-ops/dsh-excalidraw-canvas.git
cd dsh-excalidraw-canvas
npm run setup:desktop
npm run desktop:config
```

在 **DSH Desktop 的插件管理器**安装 `github:zhiyaunhe-ops/dsh-excalidraw-canvas`，然后把最后一条命令输出的字段填入 `canvas-session-scope` 配置，尤其是 `mode: desktop` 和 `desktopDirectory`。

插件会启动本地服务并连接 Excalidraw MCP。打开 <http://127.0.0.1:9112/library/>，若要编辑网页中的已有画布，点击「助手」，复制绑定指令到一个新的 Desktop 对话。直接在未绑定的 Desktop 对话里提出新绘图任务，会在后台创建另一张独立画布。之后继续使用同一个对话，历史和输入保留在 Desktop 中。退出 Desktop 或停用插件会停止本地服务，画布文件保留。

本机模式仍需保留准备好的仓库目录；插件从这里启动工作空间。只安装 bundle 不会下载和构建画布界面。不要同时运行 `npm run desktop` 和 Desktop 中的本地模式，两个实例使用相同端口。[详细步骤及自定义目录、端口](INSTALL.md#desktop)。

## 云端安装

在同一台 Ubuntu 主机准备好 `web` profile 和监听 `127.0.0.1:8790` 的 `dsh-web` 服务，然后执行：

```bash
sudo env PATH="$PATH" ./install.sh canvas.example.com
./scripts/install-dsh-mcp.sh web
sudo env PATH="$PATH" ./dsh-embed/install.sh
```

这是直接使用仓库源码的安装方式。通过 DSH 插件管理器安装 bundle 时，最后一步改用 `CANVAS_PLUGIN_MODE=bundle`；两种接线方式二选一。[完整前提、命令和配置](INSTALL.md#cloud)。

## 使用方式

- `/library/` 管理画布：搜索、排序、新建、导入、重命名、复制、删除。
- 点击卡片进入独立的 `/canvas/<id>` 页面；自动保存和 Ctrl/Cmd+S 写入工作空间。Ctrl/Cmd+Shift+S 另存副本。
- PNG、SVG 和 `.excalidraw` 下载放在「导出」菜单。
- 云端助手在打开或新建画布时提前加载。页面内切换文档、返回画布库和收起侧栏均保留已加载的助手实例；整页刷新会重新初始化。
- Desktop 模式直接使用 Desktop 对话，不加载云端助手 iframe。本机保存状态会显示「已保存到本机」。
- 新的独立 agent 首次调用画布工具时，默认后台新建并绑定自己的图；也可用 `canvas_create` 指定名称。它不会修改或切走用户当前打开的图。只有明确指定已有图时才用 `canvas_select`。每轮注入目标 ID、名称、地址、路径和版本，子任务继承父任务目标。
- 不同画布使用独立执行环境，元素、分组和快照分开，工具可以同时执行。同一画布内的调用自动按顺序执行；其他图的对话、绘图和保存继续进行。打开哪张图只影响查看，不决定 agent 的编辑目标。
- 工作空间保存元素、图片和背景；重启后恢复当前画布。并发修改产生冲突时，可另存副本或重新载入。

## 插件与市场

仓库根目录是 DSH plugin bundle：`package.json` → `dsh.bundle.patch` → `cordis.patch.yml`。包含浏览器会话入口、画布上下文和 MCP 会话路由；Desktop 模式还负责本地服务与 MCP 的启动和停止。

当前 manifest 声明的 DSH 版本是 **`0.2.1-rc.2`**，Excalidraw MCP 固定为 **`2.1.2`**。本插件已通过 [Market 收录 PR #15591](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/15591) 收录到 awesome-dsh-plugin。也可直接使用 GitHub 地址安装。

## 源码与验证

| 路径 | 内容 |
|---|---|
| `app/` | 画布库、Excalidraw 编辑器、自动保存 API |
| `plugin/` | DSH bundle 入口、配置和生成的浏览器入口 |
| `dsh-embed/plugin/dsh-canvas-session/` | 共享的会话绑定和每轮画布上下文实现 |
| `app/mcp-router.mjs`、`app/canvas-worker.mjs` | MCP 会话路由及每张画布的独立执行环境 |
| `scripts/desktop.mjs` | 无 nginx/systemd 的本机启动器 |
| `install.sh`、`scripts/install-*.sh` | 云端安装及升级 |
| `dsh-embed/` | 云端助手的同源代理与登录桥，详见[说明](dsh-embed/README.md) |

CI 执行构建和 Node 功能测试，覆盖保存、恢复、目标绑定、助手实例生命周期、插件打包及隔离的安装脚本。自动化检查不包含浏览器、截图或视觉评审；真实 Desktop 界面及各操作系统的安装体验由使用者确认。云端运行环境为 Ubuntu 24.04 arm64、Node.js 24、DSH `0.2.1-rc.2`。

MIT License。Excalidraw MCP 使用上游 [mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw)。
