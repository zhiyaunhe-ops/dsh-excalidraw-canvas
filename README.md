# dsh-excalidraw-canvas

把 **Excalidraw 云端画布工作空间**接到 DeepSeek Harness（`dsh`）：管理图纸、直接编辑、自动保存，并与 agent 一起绘图。

进入 `/library/` 查看云端画布；点击卡片进入独立的 `/canvas/<id>` 编辑页。编辑页支持自动保存、Ctrl/Cmd+S 保存、Ctrl/Cmd+Shift+S 另存云端副本。PNG、SVG、源文件下载统一放在「导出」。

## DSH 插件与市场安装

仓库根目录现在是 `dsh-excalidraw-canvas` 插件 bundle（`package.json` → `dsh.bundle.patch` → `cordis.patch.yml`），包含浏览器会话插件及 host 的画布上下文、工具目标绑定。已验证的 DSH 版本为 `0.2.1-rc.2`。

**先部署云端工作空间和 MCP 服务，再安装插件。** 这个 bundle 接入已有工作空间；它不会在 DSH 插件安装过程中创建 systemd、nginx、证书或云服务器。

云端工作空间按下文 `sudo ./install.sh` 部署，MCP 按 `./scripts/install-dsh-mcp.sh web` 接线。然后在 DSH 的插件管理器通过此 GitHub 地址安装 bundle，或使用：

```bash
dsh plugin --profile web add github:zhiyaunhe-ops/dsh-excalidraw-canvas
```

在 `canvas-session-scope` 的插件配置中设置：`libraryDir`（默认 `/var/www/canvas-library`）、`workspaceUrl`（默认 `http://127.0.0.1:9111`）、`publicUrl`（实际画布网址）。画布网站内的助手仍需 `dsh-embed` 的同源代理和登录桥。

`dsh-embed/install.sh` 会直接安装本地版本的同一组插件。该方式与 bundle 安装二选一；从本地接线迁移到 bundle 时，先移除 profile patch 中旧的 `canvas-session` / `canvas-session-scope` 插入条目，再安装 bundle，保留现有画布文件和会话绑定。

GitHub 公开和添加 `dsh-plugin` topic 便于发现，但不会自动加入 DSH Market。Market 使用 awesome-dsh-plugin 收录目录；收录文件已备于 `publishing/zhiyaunhe-ops__dsh-excalidraw-canvas.yml`，合并收录后才会进入该市场的搜索结果。

## 云端工作空间

- 画布库：搜索、按最近更新或名称排序、新建、导入 `.excalidraw`、重命名、复制、删除。
- 编辑器：文档名称、保存状态、浅色/深色外观、响应式界面、dsh 助手侧栏。
- 助手在进入工作空间、打开或新建画布时提前加载；展开/收起、返回画布库以及切回已打开的文档，都保留当前页面内的助手实例、输入和滚动状态。只有显式点「重新连接」或整页刷新才重新加载。
- 元素、图片文件与画布背景均保存在服务器 `/var/www/canvas-library/drawings/`，兼容原有 `.excalidraw` 文件；重启会恢复当前画布。
- 助手通过原有 MCP 服务操作当前画布，变更由工作空间监听并自动落盘。单个 MCP 服务仍对应一张当前画布；其他已打开的文档可独立编辑并保存，界面提供「让助手连接这张画布」。
- 保存遇到其他窗口或助手的同时修改时，显示冲突提示，可保留为云端副本或重新载入。
- 助手会话绑定固定画布 ID，映射保存在服务器 `.assistant-bindings.json`，不依赖会话名称或浏览器当前页。每轮注入目标名称、ID、地址、文件路径和最新版本，子任务继承同一目标。
- Excalidraw 工具执行前核对绑定与当前画布，执行期间固定目标。用户切到另一张图时，当前工具先落盘再切换，旧会话后续调用不会写入新图。MCP 导出也不能直接覆写云端画布文件，避免绕过保存与版本管理。普通 dsh 会话可用 `canvas_list` / `canvas_select` 明确选择，`canvas_context` 查看绑定。
- 从已有部署升级会话范围：工作空间更新启动后，执行 `sudo ./scripts/install-session-scope.sh`。它迁移旧会话并热加载 host 插件，不重启 dsh。

已有部署升级：

```bash
sudo ./scripts/install-workspace.sh
```

升级会备份画布库和 nginx 站点配置，首次启动会将正在运行的画布收进云端库，不需要重启 MCP 或 dsh。新安装的根目录 `install.sh` 已包含工作空间安装。

工作空间源码在 `app/`，服务为 `canvas-workspace`（127.0.0.1:9111）。构建命令是 `cd app && npm ci && npm run build`。CI 只运行 Node 功能测试与构建，不做视觉检查。

## 结构

```
Agents Anywhere / 任意客户端
        │  聊天指令
        ▼
   dsh web  (127.0.0.1:8790)  ──stdio──▶  mcp-excalidraw-server   26 个 MCP 工具
        │                                       │  HTTP + WebSocket  127.0.0.1:3000
        │                                       ▼
        │                              excalidraw-canvas (systemd 常驻)
        ▼                                       ▲
  nginx :443  canvas-<ip>.sslip.io  ────────────┘
        ▲                    │
        │                    └─ /library/  云端画布库（workspace :9111）
        │                       /dsh/      同源反代的 dsh 小窗（可选）
        │  ?k=<token> → 90 天 HttpOnly cookie
   手机 / 平板 / 桌面浏览器
```

## 前置条件

- Ubuntu 22.04+（x86_64 或 arm64 均可），已有 `nginx` 和 `certbot`
- Node.js ≥ 20，`node` 在 PATH 里
- 一个能解析到本机的域名；没有的话脚本默认用 `<公网IP>.sslip.io`

## 安装

```bash
git clone https://github.com/zhiyaunhe-ops/dsh-excalidraw-canvas.git
cd dsh-excalidraw-canvas
sudo ./install.sh                       # 自动推断 canvas-<ip>.sslip.io
sudo ./install.sh canvas.example.com    # 或指定自己的域名
```

脚本会：装 npm 包 → 写并启动 systemd 服务 → 生成令牌和 nginx 门禁 → 申请 Let's Encrypt 证书 → 打印访问链接。

然后接 dsh：

```bash
./scripts/install-dsh-mcp.sh web      # 默认 profile 就是 web
sudo systemctl restart dsh-web
```

不想用脚本，就手动把 [templates/cordis.patch.insert.yml.tpl](templates/cordis.patch.insert.yml.tpl) 渲染后追加到 `~/.dsh/profiles/web/cordis.patch.yml`。

## 日常使用

```bash
sudo ./scripts/canvas-link.sh             # 打印当前链接（首次访问会下发 cookie）
sudo ./scripts/canvas-link.sh --rotate    # 换令牌：旧链接和旧 cookie 立即失效
sudo systemctl status excalidraw-canvas   # 画布服务
excalidraw-canvas status                  # npm 包自带的 CLI，同效
```

`curl -s 127.0.0.1:3000/health` 能看到 `elements_count`，用来判断 agent 到底画上去没有。

## dsh 小窗与画布库（可选）

安装登录桥和会话插件后，可在编辑页顶部点击「助手」打开对话侧栏：**一张画布一个会话**，工作区就是存画布的目录，从画布库打开文档时，侧栏会进入对应会话。点编辑器左上角返回画布库，切换前会先保存。

```bash
sudo ./dsh-embed/install.sh    # 面板 + 登录桥 + canvas-save/canvas-library + 会话插件
```

细节（为什么必须同源反代、登录桥怎么拿 token、插件的 API 坑）见 **[dsh-embed/README.md](dsh-embed/README.md)**。

日常两条命令：

```bash
canvas-save 押金流程           # 当前画布 → drawings/押金流程-<时间>.excalidraw + .png
canvas-library                 # 兼容旧版静态库脚本；新版库会直接读取文件
```

## 关键设计

- **令牌门禁在 nginx 层**：未授权请求直接 403，不落到上游进程；`?k=` 命中后下发 `exc_link` cookie，页面里的 `/api`、`/assets`、`wss://` 全部同源复用同一个 cookie。
- **单进程画布 + `EXCALIDRAW_NO_AUTOSTART=1`**：MCP 客户端只当客户端用，画布由 systemd 独占，避免两边各起一份抢 3000 端口。
- **dsh patch 必须写成 `- insert:` 列表**：`~/.dsh/profiles/web/cordis.patch.yml` 里的裸条目会被报 `patch: entry "mcp-excalidraw" not found`，新插件一律包一层 `- insert:`。
- **`failOnStartupError: false`**：画布没起来时 dsh 照常启动，只是少一组工具。

## 已验证环境

| 组件 | 版本 |
|---|---|
| mcp-excalidraw-server | 2.1.2（26 个工具） |
| Node.js | v24.22.1 (arm64) |
| OS | Ubuntu 24.04 LTS aarch64 |
| nginx / certbot | 1.24 / 2.9.0 |
| dsh | 0.2.1-rc.2，`@deepseek-ai/dsh-mcp-client@0.2.1-rc.2` |

端到端自测：stdio 握手 → `tools/list` 26 个 → `create_element` 建矩形 → 画布 `/health` 的 `elements_count` 由 0 变 1 → 浏览器经公网域名看到该元素。WebSocket 握手返回 `101 Switching Protocols`。

## 安全说明

- 令牌就是密码，拿到就能看画布；`canvas-link.sh --rotate` 随时可以作废。
- cookie 是 `HttpOnly; Secure; SameSite=Lax`，90 天有效。
- 画布工作空间持续将当前状态写入服务器文件；重启工作空间或 MCP 服务后会恢复当前文档。

## 卸载

```bash
sudo ./uninstall.sh
```

会停并删服务、nginx 站点与门禁配置、令牌目录；npm 包和证书保留，需要时自己 `npm rm -g` / `certbot delete`。

## License

MIT
