# Raysurfer Code Caching MCP Server

[Website](https://www.raysurfer.com) · [Docs](https://docs.raysurfer.com) · [Dashboard](https://www.raysurfer.com/dashboard/api-keys)

MCP server that caches and reuses code from prior AI agent executions. Search before coding, upload after success.

No install required — runs via `npx`.

## Setup

Get your API key from the [dashboard](https://www.raysurfer.com/dashboard/api-keys).

### Claude Desktop

Add to your `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "raysurfer": {
      "command": "npx",
      "args": ["-y", "raysurfer-code-caching-mcp"],
      "env": {
        "RAYSURFER_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add raysurfer -e RAYSURFER_API_KEY=YOUR_API_KEY_HERE -- npx -y raysurfer-code-caching-mcp
```

### VS Code

Add to your `.vscode/mcp.json`:

```json
{
  "inputs": [
    {
      "password": true,
      "id": "raysurfer-api-key",
      "type": "promptString",
      "description": "Raysurfer API Key"
    }
  ],
  "servers": {
    "raysurfer": {
      "command": "npx",
      "args": ["-y", "raysurfer-code-caching-mcp"],
      "env": {
        "RAYSURFER_API_KEY": "${input:raysurfer-api-key}"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `raysurfer_search` | Search for cached code matching a task (set `public_snips: true` to include community snippets) |
| `raysurfer_upload` | Upload code after successful execution |
| `raysurfer_vote` | Vote on cached code quality |
| `raysurfer_patterns` | Get proven task-to-code patterns |

## Resources

- `raysurfer://help` - Help text about available tools and workflow
- `raysurfer://status` - Connection status and configuration

## Development

```bash
bun install
bun run build
bun run dist/index.js
```

## License

MIT
