# 追加到 ~/.dsh/profiles/<profile>/cordis.patch.yml 末尾。
# 注意：必须包在 `- insert:` 里；直接写裸条目会报 patch: entry "mcp-excalidraw" not found。
- insert:
    - id: mcp-excalidraw
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: excalidraw
        transport: stdio
        command: __NODE_BIN__
        args:
          - __MCP_ENTRY__
        env:
          EXPRESS_SERVER_URL: http://127.0.0.1:__PORT__
          EXCALIDRAW_NO_AUTOSTART: "1"
          EXCALIDRAW_EXPORT_DIR: __RUN_HOME__
        failOnStartupError: false
