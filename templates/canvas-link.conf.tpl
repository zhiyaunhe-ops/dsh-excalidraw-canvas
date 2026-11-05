# 由 dsh-excalidraw-canvas 的 install.sh / canvas-link.sh 生成，改完执行 nginx -s reload
# 命中任一凭据即放行：URL 里的 ?k=<token>，或之前下发的 exc_link cookie。

map $cookie_exc_link $exc_cookie_ok { default 0; __TOKEN__ 1; }
map $arg_k $exc_arg_ok { default 0; __TOKEN__ 1; }

map "$exc_cookie_ok:$exc_arg_ok" $exc_deny {
    "0:0" 1;
    default 0;
}

# 只有 URL 带对令牌才下发 cookie，之后同源请求都靠它
map $exc_arg_ok $exc_set_cookie {
    default "";
    1 "__COOKIE_NAME__=__TOKEN__; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000";
}

map $http_upgrade $canvas_conn {
    default upgrade;
    ""      close;
}
