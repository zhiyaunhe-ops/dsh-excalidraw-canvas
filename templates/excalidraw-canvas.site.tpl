# /etc/nginx/sites-available/excalidraw-canvas  (Oracle Cloud, arm-free-01)
# Excalidraw 直播画布（127.0.0.1:__PORT__）的公网 HTTPS 入口。
#   * 80：ACME 校验 + 301 到 https
#   * 443：?k=<钥匙> 或 exc_link cookie 才能进；页面、/api、WebSocket 全部同源代理
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme;
        default_type text/plain;
        access_log off;
    }

    location = /healthz { access_log off; return 200 "ok\n"; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name __DOMAIN__;

    ssl_certificate     /etc/letsencrypt/live/__DOMAIN__/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/__DOMAIN__/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:CANVASSSL:10m;
    ssl_session_timeout 1d;

    server_tokens off;
    client_max_body_size 25m;
    gzip on;
    gzip_min_length 1024;
    gzip_comp_level 5;
    gzip_types text/plain text/css application/json application/javascript text/javascript image/svg+xml;

    access_log /var/log/nginx/canvas.access.log;
    error_log  /var/log/nginx/canvas.error.log warn;

    location = /healthz {
        access_log off;
        add_header Content-Type text/plain;
        return 200 "ok\n";
    }

    # 画布首页：注入一个回到画布库的悬浮按钮（只改这一份 HTML，不碰静态资源）
    location = / {
        if ($exc_deny) { return 403; }
        add_header Set-Cookie $exc_set_cookie always;
        add_header X-Robots-Tag "noindex, nofollow" always;
        add_header Referrer-Policy "no-referrer" always;

        proxy_pass http://127.0.0.1:__PORT__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $canvas_conn;
        proxy_set_header Accept-Encoding "";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;

        sub_filter_once on;
        sub_filter '</body>' '<style id="dsh-lib-style">.dsh-lib-back{position:fixed;right:18px;bottom:18px;z-index:5;font:600 13px/1 -apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif}.dsh-lib-back a{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;background:rgba(28,31,36,.86);color:#fff;text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.25);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.12)}.dsh-lib-back a:hover{background:rgba(28,31,36,.96)}</style><div class="dsh-lib-back"><a href="/library/" title="打开画布库">← 画布库</a></div><link rel="stylesheet" href="/dsh-embed/embed.css"><script src="/dsh-embed/embed.js" defer></script></body>';
    }

    location = /dsh/login {
        # 给同源 iframe 发 dsh cookie（token 由 dsh-embed-login 从 journal 取）
        if ($exc_deny) { return 403; }
        proxy_pass http://127.0.0.1:9110/login;
        proxy_set_header Host 127.0.0.1:9110;
        proxy_redirect off;
    }

    location /dsh/ {
        # 把 dsh web 反代到画布同源路径下（iframe 需要同源 cookie）
        if ($exc_deny) { return 403; }
        add_header X-Robots-Tag "noindex, nofollow" always;

        proxy_pass http://127.0.0.1:8790/;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:8790;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $canvas_conn;
        proxy_set_header Origin "";
        proxy_set_header Referer "";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_redirect off;
    }

    location /dsh-embed/ {
        # dsh 对话小窗的静态资源
        if ($exc_deny) { return 403; }
        add_header X-Robots-Tag "noindex, nofollow" always;
        alias /var/www/canvas-embed/;
    }

    location /library/ {
        # 画布库：存过的 .excalidraw + PNG 预览，同一把令牌门禁
        if ($exc_deny) { return 403; }
        add_header Set-Cookie $exc_set_cookie always;
        add_header X-Robots-Tag "noindex, nofollow" always;
        add_header Referrer-Policy "no-referrer" always;
        alias /var/www/canvas-library/;
        index index.html;
    }

    location / {
        # 钥匙校验：没有 ?k= 也没有 cookie → 拒绝
        if ($exc_deny) { return 403; }
        add_header Set-Cookie $exc_set_cookie always;
        add_header X-Robots-Tag "noindex, nofollow" always;
        add_header Referrer-Policy "no-referrer" always;

        proxy_pass http://127.0.0.1:__PORT__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $canvas_conn;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
