#!/usr/bin/env python3
"""Migrate canvas-session titles to durable bindings without changing conversations."""
import json
import os
from pathlib import Path
import subprocess
import urllib.request

base = os.environ.get('CANVAS_WORKSPACE_URL', 'http://127.0.0.1:9111') + '/workspace/api'
home = Path(os.environ.get('DSH_RUN_HOME', str(Path.home())))
with urllib.request.urlopen(base + '/documents', timeout=15) as response:
    ids = {item['id'] for item in json.load(response)['documents']}
count = 0
for file in (home / '.dsh/sessions/--var-www-canvas-library-drawings--').glob('*/session.v4.jsonl.zstd'):
    result = subprocess.run(['zstd', '-dc', str(file)], capture_output=True, check=True, text=True)
    session_id = None
    title = None
    for line in result.stdout.splitlines():
        event = json.loads(line)
        if event.get('type') == 'session': session_id = event['id']
        if event.get('type') == 'session/title': title = event['data']['title']
    if not title or not title.startswith('画布 · '): continue
    canvas_id = title.removeprefix('画布 · ')
    if canvas_id not in ids: continue
    body = json.dumps({'sessionId': session_id, 'canvasId': canvas_id}).encode()
    request = urllib.request.Request(base + '/assistant/bindings', data=body, headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=15) as response: json.load(response)
    count += 1
print(f'已迁移 {count} 个现有画布会话的绑定；聊天内容未修改')
