# dsh-excalidraw-canvas

把 **Excalidraw 直播画布**接到 DeepSeek Harness（`dsh`），再用一条带令牌的 HTTPS 链接，从任何浏览器看 agent 边画边出图。

一句话版本：agent 调 MCP 工具逐个追加元素，画布那边同步长出来；你只要开着网页，聊天窗开一半、网页拖一半就行。

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
        │                    └─ /library/  画布库（存过的 .excalidraw + 预览）
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

画布页右下角可以再挂一个 dsh 对话面板：**一张画布一个会话**，工作区就是存画布的目录，点「载入画布」切图时面板会跟着换会话。同一页还有「← 画布库」，存过的图都列在那里，点一下就能装回画布中。

```bash
sudo ./dsh-embed/install.sh    # 面板 + 登录桥 + canvas-save/canvas-library + 会话插件
```

细节（为什么必须同源反代、登录桥怎么拿 token、插件的 API 坑）见 **[dsh-embed/README.md](dsh-embed/README.md)**。

日常两条命令：

```bash
canvas-save 押金流程           # 当前画布 → drawings/押金流程-<时间>.excalidraw + .png
canvas-library                 # 重新生成 /library/ 首页
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
- 画布状态由进程持有，重启服务等于开一张新图；需要留存就先导出 `.excalidraw` 或 PNG（`/api/export/image`）。

## 卸载

```bash
sudo ./uninstall.sh
```

会停并删服务、nginx 站点与门禁配置、令牌目录；npm 包和证书保留，需要时自己 `npm rm -g` / `certbot delete`。

## License

MIT
