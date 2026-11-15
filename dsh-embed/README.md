# 云端画布中的 DSH 助手

这是**云端模式**的同源助手桥。Desktop 本机使用 DSH 自己的对话，不安装本目录中的登录桥或 nginx 配置。两种方式的完整步骤见 [INSTALL.md](../INSTALL.md)。

## 当前界面

`app/src/AssistantDock.jsx` 持有按画布 ID 缓存的助手 iframe。进入工作空间、打开或新建画布时提前加载；收起侧栏、返回画布库和页面内切换文档不销毁已加载实例。显式「重新连接」和整页刷新会重新初始化 iframe，已有 DSH 会话继续复用。

```text
/canvas/<id>（工作空间编辑页）
  └─ 常驻 AssistantDock
       └─ /dsh/login?canvas=<id>（登录桥）
            └─ /dsh/?canvas=<id>（同源代理到 DSH web:8790）
                 └─ 浏览器插件找/建对应会话，先持久化绑定再打开对话
```

旧的 `web/embed.js`、`web/embed.css` 和静态 `canvas-library` 脚本为旧页面保留，新版编辑器不使用旧悬浮面板。画布库由工作空间实时读取文件。

## 安装约定

需要同一主机、同一运行用户的 `web` profile、`dsh-web` systemd 服务以及 `127.0.0.1:8790`。根安装器已部署画布应用和 nginx 后，再按接线方式选一条：

```bash
# 源码接线
sudo env PATH="$PATH" ./dsh-embed/install.sh
```

```bash
# 已通过 DSH 插件管理器安装根目录 bundle
sudo env PATH="$PATH" CANVAS_PLUGIN_MODE=bundle ./dsh-embed/install.sh
```

默认 `local` 指源码接线，不能与 bundle 重复安装。脚本兼容 `.conf` 和旧的无后缀 nginx 站点文件；自定义文件通过 `CANVAS_SITE` 指定。已有工作空间服务时不会再构建和重启一次。

## 代理与登录桥

nginx 将 `/dsh/` 代理到 DSH web，让 iframe 与画布页面同源。模板保留 DSH 所需的 Host、Origin 和 Referer 转发设置；单独在别的域名嵌入 DSH 登录页不能替代这套接线。

`login/dsh-embed-login.py` 监听 `127.0.0.1:9110`，从 `journalctl -u dsh-web` 读取当前启动的登录链接，完成登录交换后跳到 `/dsh/?canvas=<id>`。`GET /healthz` 检查桥是否运行。DSH 重启导致旧登录状态失效时，使用「重新连接」。

## 会话与画布范围

浏览器插件位于 `plugin/dsh-canvas-session/client.js`。它从 URL 读取画布 ID，等待 sessions/workspaces 列表 ready，复用本地记住的会话；首次或换设备时按约定标题查找，找不到才创建。每次打开前，先向工作空间登记 `sessionId → canvasId`。

权威绑定保存在 `/var/www/canvas-library/.assistant-bindings.json`。绑定完成后，重命名画布或会话不会改变编辑目标。浏览器 localStorage 用于定位会话，不能替代服务器的固定绑定。已有旧会话由 `scripts/bind-existing-sessions.py` 迁移，它只读取日志，不修改聊天内容。

host 插件 `host.js` 每轮读取绑定文件与图纸，将 ID、名称、地址、路径和最新版本注入助手上下文。子会话沿 `parentSession` 继承目标。`mcp__excalidraw__*` 执行前核对当前画布，执行期间固定目标，结束后保存再释放；切换图纸会等这次工具完成。导出不能直接覆写工作空间的 drawings 文件。

普通 DSH 对话也可调用 `canvas_list`、`canvas_select`、`canvas_context`。一个会话固定对应一张画布；另一个目标使用另一个对话。单个 MCP 实时服务同时对应一张当前画布。

## 源码接线升级

先更新并启动工作空间，再更新范围插件：

```bash
sudo env PATH="$PATH" ./scripts/install-workspace.sh
sudo env PATH="$PATH" ./scripts/install-session-scope.sh
```

范围插件通过 profile patch 热加载，不需要重启 DSH。bundle 安装通过插件管理器更新，不执行源码接线脚本。
