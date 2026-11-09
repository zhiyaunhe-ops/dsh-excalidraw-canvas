#!/usr/bin/env python3
"""dsh-embed-login: 给画布页内嵌的 dsh 窗口发一张同源登录 cookie。

画布页把 dsh web 反代到 https://<canvas-host>/dsh/，浏览器需要一份属于
canvas 域名的 dsh-auth cookie。dsh 每次启动会打印一个一次性的 ?token= 登录
链接（在 journal 里），本服务把它换成 Set-Cookie + 302 /dsh/，让 iframe
在同一个源里完成登录。

GET /login?canvas=<stem> -> 302 /dsh/?canvas=<stem> 并带 dsh-auth cookie
GET /healthz -> "ok"
"""
from __future__ import annotations

import re
import subprocess
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DSH_UPSTREAM = "http://127.0.0.1:8790"
DSH_HOST = "127.0.0.1:8790"
TOKEN_RE = re.compile(r"token=([A-Za-z0-9_\-]{16,})")


def find_token() -> str | None:
    try:
        out = subprocess.run(
            ["journalctl", "-u", "dsh-web", "--no-pager", "-o", "cat", "-n", "5000"],
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout
    except Exception as exc:  # noqa: BLE001
        print(f"journalctl failed: {exc}", file=sys.stderr)
        return None
    hits = TOKEN_RE.findall(out)
    return hits[-1] if hits else None


def login_cookie() -> str | None:
    token = find_token()
    if not token:
        return None
    req = urllib.request.Request(
        f"{DSH_UPSTREAM}/?token={token}",
        headers={"Host": DSH_HOST},
    )
    opener = urllib.request.build_opener(NoRedirect)
    try:
        resp = opener.open(req, timeout=10)
    except urllib.error.HTTPError as exc:  # 302 also lands here
        resp = exc
    return resp.headers.get("Set-Cookie")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


class Handler(BaseHTTPRequestHandler):
    server_version = "dsh-embed-login/1"

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] == "/healthz":
            return self._send(200, b"ok\n", "text/plain")
        if self.path.split("?")[0] != "/login":
            return self._send(404, b"not found\n", "text/plain")

        cookie = login_cookie()
        if not cookie:
            return self._send(
                503,
                b"dsh web login token not found in journalctl; restart dsh-web\n",
                "text/plain",
            )
        # 画布身份：?canvas=<stem> 由 embed.js 传入，随重定向带进 dsh，供
        # dsh-canvas-session 插件把「一张画布」绑到「一个 session」。
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        canvas = (query.get("canvas") or [""])[0][:120]
        target = "/dsh/"
        if canvas:
            target += "?canvas=" + urllib.parse.quote(canvas, safe="")
        self.send_response(302)
        self.send_header("Location", target)
        self.send_header("Set-Cookie", cookie)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        sys.stderr.write("dsh-embed-login: " + fmt % args + "\n")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 9110), Handler).serve_forever()
