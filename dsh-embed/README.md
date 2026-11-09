# dsh 小窗：在画布页里直接对话

在画布页右下角挂一个 dsh 对话面板，**一张画布一个会话**，工作区固定在画布库目录
（`/var/www/canvas-library/drawings`，即 `~/canvases`）。点「载入画布」切到别的图，
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

`plugin/dsh-canvas-session` 是一个 **dsh 浏览器端插件**（纯 UI，没有 host 侧逻辑）。

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

- 画布状态在服务进程内存里，**重启 excalidraw-canvas 就是一张白纸**；要留住就
  `canvas-save <名字>`，或在画布库点「载入画布」。
- 登录桥从 journal 抓 token，`dsh-web` 重启后旧 cookie 失效，需要点「重登」。
- 会话映射存在浏览器 localStorage，换浏览器靠标题兜底；标题被手动改掉就会新建。
