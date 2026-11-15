# dsh 助手：在云端画布里直接对话

编辑页顶部「助手」打开 dsh 对话侧栏，**一张画布一个会话**，工作区固定在画布库目录
（`/var/www/canvas-library/drawings`，即 `~/canvases`）。从画布库打开另一张图时，
小窗会自动换成那张图的会话。

```
画布页 https://<canvas>/ 
  └─ /dsh-embed/embed.js        悬浮按钮 + 可缩放面板（iframe 懒加载）
       └─ /dsh/login?canvas=X  登录桥：发 dsh-auth cookie，302 → /dsh/?canvas=X
            └─ /dsh/            nginx 同源反代 → 127.0.0.1:8790（dsh web）
                 └─ 插件 dsh-canvas-session：按 canvas=X 找/建专属会话
```

## 为什么是反代而不是 iframe 直连

dsh 的登录 cookie 是 `SameSite=Strict`，而 `canvas-*.sslip.io` 和 `dsh-*.sslip.io`
在浏览器眼里是**跨站**（sslip.io 不在公共后缀表里，退化成“整域 = 站点”），跨站
iframe 里 Strict cookie 根本发不出去。所以必须把 dsh 反代到画布域名下的 `/dsh/`，
让 iframe 与父页面同源。

反代两个必须的细节（漏了就是 403）：

- `proxy_set_header Host 127.0.0.1:8790;` —— dsh 的 `/api` 有 Host 围栏，Host 不对直接拒；
- `proxy_set_header Origin ""; proxy_set_header Referer "";` —— 不清掉浏览器带的
  canvas 源，dsh 会判成跨站请求。

## 登录桥为什么存在

dsh web 每次启动打印一个一次性的 `?token=` 登录链接，只出现在 journal 里。浏览器
没法自己去读，所以 `dsh-embed-login.py`（systemd，监听 127.0.0.1:9110）替它取：

- `GET /login?canvas=<stem>`：从 `journalctl -u dsh-web` 抓最后一个 token，向 8790
  换出 `Set-Cookie`，`302` 到 `/dsh/?canvas=<stem>`；
- `GET /healthz`：`ok`。

重登按钮就是重新走一次 `/dsh/login`。

## 一画布一 session 插件

`plugin/dsh-canvas-session` 包含浏览器会话入口与 host 范围插件。浏览器端负责找/建会话并将 session ID 与 canvas ID 注册到工作空间；`host.js` 负责每轮上下文和 Excalidraw 工具的固定目标。

- `package.json` 的 `dsh.client.platform = "web"`，`exports["./client"]` 指向浏览器包；
- `client.js` 是 `window.__ModuleLoader__.load({...})` 形式的 cordis 插件，
  `inject = ["sessions", "workspaces", "uiWorkspace"]`；
- 从 URL 拿 `canvas` → 等两个列表快照 `phase === "ready"` → 查
  `localStorage["dsh-canvas-session:<stem>"]`，命中且会话还在就打开；否则按标题
  `画布 · <stem>` 兜底找（换浏览器/换设备也能复用）；都没有才 `sessions.create()`
  并改名，然后 `uiWorkspace.openSession(id)`。

安装方式是软链进 profile 的 `node_modules`，并在 `cordis.patch.yml` 里插一条：

```yaml
- insert:
    - id: canvas-session
      name: dsh-canvas-session
```

**host 的 cordis loader 会热加载 `cordis.patch.yml`，改完不用重启 dsh-web。**

### 踩过的 API 坑

- `ctx.get("sessions")` 是 ClientSessions：`create(opts)` **直接 resolve 出
  sessionId 字符串**，失败是 throw（`SessionCreateError`），不是 `RemoteResult`；
- `rename` 不在 ClientSessions 上，要用
  `sessions.using(id, { source }, (ref) => ref.binding.session.rename(title))`；
- 列表快照形状：`{ ids, byId, phase }`；工作区是 `{ items: [{ workspaceId, path, title }], phase }`；
- create 大约要 1s，300ms 的轮询必须加 in-flight 守卫，否则一次失败能喷出几十个空会话。

## 目录

| 路径 | 作用 |
| --- | --- |
| `web/embed.js`, `web/embed.css` | 面板本体，部署到 `/var/www/canvas-embed/` |
| `login/dsh-embed-login.py` | 登录桥，部署到运行用户家目录 |
| `login/dsh-embed-login.service.tpl` | 登录桥 systemd 单元 |
| `bin/canvas-save` | 保存当前画布（.excalidraw + PNG）并刷新画布库 |
| `bin/canvas-library` | 扫 `drawings/` 生成 `/library/` 首页 |
| `plugin/dsh-canvas-session/` | 一画布一 session 的浏览器插件 |
| `install.sh` | 一把装完上面全部 |

## 安装

```bash
# 先按仓库根目录的 README 装好画布站点，再：
sudo ./dsh-embed/install.sh
```

脚本会装文件、起登录桥、软链插件、补 `cordis.patch.yml`，最后打印访问链接。
站点 nginx 配置在 `templates/excalidraw-canvas.site.tpl`（`/dsh/`、`/dsh/login`、
`/dsh-embed/`、`/library/` 四个 location 都在里面，同样受 `?k=` 令牌门禁保护）。

## 已知限制

- 云端工作空间负责自动落盘并恢复当前文档；单个 MCP 服务同时对应一张当前画布。其他窗口切换画布后，可在编辑页重新连接助手。
- 登录桥从 journal 抓 token，`dsh-web` 重启后旧 cookie 失效，需要点「重登」。
- 会话映射存在浏览器 localStorage，换浏览器靠标题兜底；标题被手动改掉就会新建。

## 新版界面与保存

`install.sh` 现在也会安装 `../app/` 的云端工作空间。`web/embed.*` 与 `bin/canvas-library` 保留为旧版兼容资源，新版 `/library/` 由工作空间实时读取服务器文件，`/canvas/<id>` 是独立编辑地址。Ctrl/Cmd+S、自动保存和云端副本均由工作空间处理；下载从导出菜单进入。助手侧栏复用这里的登录桥和一画布一会话插件。新版由 App 持有按画布 ID 复用的常驻助手实例，新建/打开画布时就开始加载；收起侧栏与页面内切换不会销毁 iframe。整页刷新会重新初始化，已有会话仍按原映射恢复。

## 会话编辑范围

`host.js` 作为独立 `canvas-session-scope` 条目装进 profile，可热加载而不重启 dsh。浏览器必须先完成 `/workspace/api/assistant/bindings` 注册再打开会话。已有会话可用 `scripts/bind-existing-sessions.py` 从旧会话标题迁移绑定，脚本只读取日志，不修改聊天内容。

绑定一旦存在，不随会话或画布改名改变。host 的 required prompt context 每轮读取该映射和对应 `.excalidraw` 文件的最新名称与版本，包含地址、路径和范围说明。子会话沿 parentSession 继承绑定；绑定目标已删除时不会自动落到其他画布。

host 包裹 `mcp__excalidraw__*` 调用，开始前向工作空间领取工具运行记录，验证当前画布与会话目标一致。期间浏览器对同一画布的保存会稍后重试；打开其他图会排队至此次工具落盘结束。finally 中保存并释放，工具失败或取消也会释放。若窗口已切走，旧会话的下一次绘图调用会返回明确的目标不一致提示。这个范围控制用于 dsh 插件的绘图工具；它不改变主机通用文件或 shell 权限。MCP 导出到云端 drawings 目录（包含 ~/canvases 目录软链）会被拒绝；云端保存由工作空间负责，下载副本使用独立导出目录。
