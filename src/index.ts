#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const VERSION = "1.0.2";
const BASE_URL = "https://api.raysurfer.com";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function getApiKey(): string | undefined {
  /** Read the Raysurfer API key from the environment. */
  return process.env.RAYSURFER_API_KEY;
}

async function apiRequest<T>(
  path: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<T> {
  /** Make an authenticated POST request to the Raysurfer API. */
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "RAYSURFER_API_KEY environment variable is not set. " +
        "Get your key at https://www.raysurfer.com"
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-Raysurfer-SDK-Version": `mcp/${VERSION}`,
    ...extraHeaders,
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Raysurfer API error (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Result formatting helpers
// ---------------------------------------------------------------------------

interface SearchMatch {
  code_block: {
    id: string;
    name: string;
    description: string;
    source: string;
    entrypoint: string;
    language: string;
    dependencies: Record<string, string>;
  };
  combined_score: number;
  vector_score: number;
  verdict_score: number;
  error_resilience: number;
  thumbs_up: number;
  thumbs_down: number;
  filename: string;
  language: string;
}

interface SearchApiResponse {
  matches: SearchMatch[];
  total_found: number;
  cache_hit: boolean;
}

interface UploadApiResponse {
  success: boolean;
  code_blocks_stored: number;
  message: string;
  status_url: string | null;
}

interface VoteApiResponse {
  success: boolean;
  vote_pending?: boolean;
  message: string;
}

interface PatternItem {
  task_pattern: string;
  code_block_id: string;
  code_block_name: string;
  thumbs_up: number;
  thumbs_down: number;
  verdict_score: number;
}

interface PatternsApiResponse {
  patterns: PatternItem[];
}

function formatSearchResults(data: SearchApiResponse): string {
  /** Format search API response into readable text for Claude. */
  if (data.matches.length === 0) {
    return `No cached code found (searched ${data.total_found} total snippets).`;
  }

  const lines: string[] = [
    `Found ${data.matches.length} match${data.matches.length > 1 ? "es" : ""} (${data.total_found} total, cache_hit=${data.cache_hit}):`,
    "",
  ];

  for (let i = 0; i < data.matches.length; i++) {
    const m = data.matches[i];
    const cb = m.code_block;
    lines.push(`--- Match ${i + 1} ---`);
    lines.push(`ID: ${cb.id}`);
    lines.push(`Name: ${cb.name}`);
    lines.push(`Description: ${cb.description}`);
    lines.push(`Language: ${m.language}`);
    lines.push(`File: ${m.filename}`);
    lines.push(
      `Score: ${m.combined_score.toFixed(3)} (vector=${m.vector_score.toFixed(3)}, verdict=${m.verdict_score.toFixed(3)})`
    );
    lines.push(`Votes: +${m.thumbs_up} / -${m.thumbs_down}`);
    if (cb.dependencies && Object.keys(cb.dependencies).length > 0) {
      const deps = Object.entries(cb.dependencies).map(([k, v]) => `${k}@${v}`);
      lines.push(`Dependencies: ${deps.join(", ")}`);
    }
    lines.push(`Entrypoint: ${cb.entrypoint}`);
    lines.push("");
    lines.push("```" + (cb.language || ""));
    lines.push(cb.source);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function formatPatterns(data: PatternsApiResponse): string {
  /** Format patterns API response into readable text for Claude. */
  if (data.patterns.length === 0) {
    return "No proven patterns found.";
  }

  const lines: string[] = [
    `Found ${data.patterns.length} proven pattern${data.patterns.length > 1 ? "s" : ""}:`,
    "",
  ];

  for (const p of data.patterns) {
    lines.push(`- "${p.task_pattern}"`);
    lines.push(
      `  Code: ${p.code_block_name} (${p.code_block_id})`
    );
    lines.push(
      `  Votes: +${p.thumbs_up} / -${p.thumbs_down}, verdict=${p.verdict_score.toFixed(2)}`
    );
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  {
    name: "raysurfer-code-caching-mcp",
    version: VERSION,
  },
  {
    instructions:
      "Raysurfer MCP server provides tools for searching, uploading, and voting on cached code snippets. " +
      "Use raysurfer_search to find previously cached code before writing new code. " +
      "Use raysurfer_upload after a successful execution to share code with the community cache. " +
      "Use raysurfer_vote to rate cached code that was used. " +
      "Use raysurfer_patterns to discover proven task-to-code mappings.",
  }
);

// ---------------------------------------------------------------------------
// Tool: raysurfer_search
// ---------------------------------------------------------------------------

server.registerTool(
  "raysurfer_search",
  {
    title: "Search Cached Code",
    description:
      "Search for cached code snippets matching a task description. " +
      "Returns ranked matches with source code, scores, and metadata. " +
      "Use this before writing new code to check if a solution already exists.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      task: z.string().describe("Task description to search for"),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(5)
        .describe("Number of results to return (1-100, default 5)"),
      min_score: z
        .number()
        .min(0)
        .max(1)
        .default(0.3)
        .describe("Minimum verdict score threshold (0-1, default 0.3)"),
      public_snips: z
        .boolean()
        .default(false)
        .describe("Include community public snippets in results (default false)"),
    },
  },
  async ({ task, top_k, min_score, public_snips }) => {
    try {
      const extraHeaders = public_snips
        ? { "X-Raysurfer-Public-Snips": "true" }
        : undefined;
      const data = await apiRequest<SearchApiResponse>(
        "/api/retrieve/search",
        {
          task,
          top_k: top_k ?? 5,
          min_verdict_score: min_score ?? 0.3,
          prefer_complete: true,
        },
        extraHeaders
      );

      return {
        content: [{ type: "text", text: formatSearchResults(data) }],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{ type: "text", text: `Search failed: ${message}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: raysurfer_upload
// ---------------------------------------------------------------------------

server.registerTool(
  "raysurfer_upload",
  {
    title: "Upload Code to Cache",
    description:
      "Upload code files from a successful execution to the Raysurfer cache. " +
      "This stores the code so it can be reused by others for similar tasks. " +
      "Call this after completing a coding task successfully.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      task: z
        .string()
        .describe("Task description that this code accomplishes"),
      file: z
        .object({
          path: z.string().describe("File path (e.g. 'src/utils.ts')"),
          content: z.string().describe("Full file content"),
        })
        .describe("File to upload to the cache"),
      succeeded: z
        .boolean()
        .default(true)
        .describe("Whether the execution succeeded (default true)"),
    },
  },
  async ({ task, file, succeeded }) => {
    try {
      const data = await apiRequest<UploadApiResponse>(
        "/api/store/execution-result",
        {
          task,
          file_written: file,
          succeeded: succeeded ?? true,
          use_raysurfer_ai_voting: true,
        }
      );

      const stored = data.code_blocks_stored ?? 0;
      return {
        content: [
          {
            type: "text",
            text: `Upload ${data.success ? "successful" : "failed"}: ${stored} code block${stored !== 1 ? "s" : ""} stored. ${data.message}`,
          },
        ],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{ type: "text", text: `Upload failed: ${message}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: raysurfer_vote
// ---------------------------------------------------------------------------

server.registerTool(
  "raysurfer_vote",
  {
    title: "Vote on Cached Code",
    description:
      "Vote on whether a cached code snippet was useful. " +
      "Upvote code that worked well, downvote code that did not help. " +
      "This improves ranking for future searches.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      code_block_id: z
        .string()
        .describe("ID of the code block to vote on"),
      code_block_name: z
        .string()
        .describe("Name of the code block being voted on"),
      code_block_description: z
        .string()
        .describe("Description of the code block being voted on"),
      up: z
        .boolean()
        .default(true)
        .describe("True for upvote (worked), false for downvote (default true)"),
      task: z
        .string()
        .describe("Task description for vote context"),
    },
  },
  async ({ code_block_id, code_block_name, code_block_description, up, task }) => {
    try {
      const data = await apiRequest<VoteApiResponse>(
        "/api/store/cache-usage",
        {
          code_block_id,
          code_block_name,
          code_block_description,
          succeeded: up ?? true,
          task,
        }
      );

      const voteType = (up ?? true) ? "Upvote" : "Downvote";
      return {
        content: [
          {
            type: "text",
            text: `${voteType} recorded for ${code_block_id}. ${data.message}`,
          },
        ],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [{ type: "text", text: `Vote failed: ${message}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: raysurfer_patterns
// ---------------------------------------------------------------------------

server.registerTool(
  "raysurfer_patterns",
  {
    title: "Get Proven Patterns",
    description:
      "Get proven task-to-code patterns from the community cache. " +
      "These are code snippets that have been repeatedly validated by users. " +
      "Optionally filter by task description.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      task: z
        .string()
        .optional()
        .describe("Optional task description to filter patterns"),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .describe("Number of patterns to return (default 10)"),
    },
  },
  async ({ task, top_k }) => {
    try {
      const data = await apiRequest<PatternsApiResponse>(
        "/api/retrieve/task-patterns",
        {
          task: task ?? null,
          min_thumbs_up: 1,
          top_k: top_k ?? 10,
        }
      );

      return {
        content: [{ type: "text", text: formatPatterns(data) }],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          { type: "text", text: `Patterns lookup failed: ${message}` },
        ],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Resource: raysurfer://help
// ---------------------------------------------------------------------------

server.registerResource(
  "help",
  "raysurfer://help",
  {
    title: "Raysurfer Help",
    description: "Help text about available Raysurfer tools and workflow",
    mimeType: "text/plain",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: [
          "Raysurfer MCP Server - Code Caching Tools",
          "==========================================",
          "",
          "Available tools:",
          "",
          "1. raysurfer_search - Search for cached code matching a task",
          "   Use BEFORE writing new code to check for existing solutions.",
          "   Example: { task: 'Parse CSV file and generate summary stats' }",
          "",
          "2. raysurfer_upload - Upload code after a successful execution",
          "   Use AFTER completing a task to share your solution.",
          "   Example: { task: 'Parse CSV', file: { path: 'parser.py', content: '...' } }",
          "",
          "3. raysurfer_vote - Vote on cached code quality",
          "   Use to upvote code that worked or downvote code that did not.",
          "   Example: { code_block_id: 'abc-123', up: true }",
          "",
          "4. raysurfer_patterns - Get proven task-to-code patterns",
          "   Use to discover validated code patterns from the community.",
          "   Example: { task: 'data processing', top_k: 5 }",
          "",
          "Recommended workflow:",
          "  1. Search for cached code before starting a task",
          "  2. Use cached code if a good match exists",
          "  3. Vote on the cached code after using it",
          "  4. Upload new code after completing novel tasks",
        ].join("\n"),
      },
    ],
  })
);

// ---------------------------------------------------------------------------
// Resource: raysurfer://status
// ---------------------------------------------------------------------------

server.registerResource(
  "status",
  "raysurfer://status",
  {
    title: "Raysurfer Status",
    description: "Connection status and configuration for the Raysurfer MCP server",
    mimeType: "application/json",
  },
  async (uri) => {
    const apiKey = getApiKey();
    const configured = !!apiKey;
    const masked = apiKey
      ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
      : "not set";

    let apiReachable = false;
    if (configured) {
      try {
        const response = await fetch(`${BASE_URL}/health`, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });
        apiReachable = response.ok;
      } catch {
        apiReachable = false;
      }
    }

    const status = {
      server: "raysurfer-code-caching-mcp",
      version: VERSION,
      api_key: masked,
      api_configured: configured,
      api_reachable: apiReachable,
      base_url: BASE_URL,
      tools: [
        "raysurfer_search",
        "raysurfer_upload",
        "raysurfer_vote",
        "raysurfer_patterns",
      ],
    };

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  /** Start the MCP server using STDIO transport. */
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Raysurfer MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
