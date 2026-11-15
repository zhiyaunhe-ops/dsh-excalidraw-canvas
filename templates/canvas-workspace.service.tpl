[Unit]
Description=DeepSeek Harness cloud canvas workspace
After=network.target excalidraw-canvas.service
Wants=excalidraw-canvas.service

[Service]
Type=simple
User=__RUN_USER__
WorkingDirectory=__REPO_DIR__/app
Environment=NODE_ENV=production
Environment=PORT=9111
Environment=EXCALIDRAW_PACKAGE_DIR=__PACKAGE_DIR__
Environment=EXPRESS_SERVER_URL=http://127.0.0.1:__PORT__
ExecStart=__NODE_BIN__ __REPO_DIR__/app/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
