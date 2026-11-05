[Unit]
Description=Excalidraw live canvas (mcp-excalidraw-server HTTP/WebSocket)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=__RUN_USER__
WorkingDirectory=__RUN_HOME__
Environment=NODE_ENV=production
Environment=PORT=__PORT__
Environment=HOST=127.0.0.1
Environment=EXCALIDRAW_EXPORT_DIR=__RUN_HOME__
ExecStart=__NODE_BIN__ __SERVER_JS__
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
