# Raysurfer Code Caching MCP Server

MCP (Model Context Protocol) server that provides Raysurfer code caching tools for AI assistants.

## Installation

```bash
npm install raysurfer-code-caching-mcp
```

Or with bun:

```bash
bun add raysurfer-code-caching-mcp
```

## Setup

```bash
export RAYSURFER_API_KEY=your_api_key_here
```

Get your key from the [dashboard](https://raysurfer.com/dashboard/api-keys).

## Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "raysurfer": {
      "command": "npx",
      "args": ["raysurfer-code-caching-mcp"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `raysurfer_search` | Search for cached code matching a task |
| `raysurfer_upload` | Upload code after successful execution |
| `raysurfer_vote` | Vote on cached code quality |
| `raysurfer_patterns` | Get proven task-to-code patterns |

## Resources

- `raysurfer://help` - Help text about available tools and workflow
- `raysurfer://status` - Connection status and configuration

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Run server
bun run dist/index.js
```

## License

MIT
