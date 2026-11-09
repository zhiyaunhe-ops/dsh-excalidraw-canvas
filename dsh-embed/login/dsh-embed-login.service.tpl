[Unit]
Description=DSH embed login bridge for the Excalidraw canvas iframe
After=network.target dsh-web.service
Wants=dsh-web.service

[Service]
Type=simple
User=__RUN_USER__
ExecStart=/usr/bin/python3 __RUN_HOME__/dsh-embed-login.py
Restart=always
RestartSec=3
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
