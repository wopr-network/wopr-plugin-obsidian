import type { ObsidianClient } from "./obsidian-client.js";

type ToolResult = { content: [{ type: "text"; text: string }]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function buildA2ATools(client: ObsidianClient) {
  return [
    {
      name: "obsidian.search",
      description: "Search notes in the Obsidian vault by keyword or phrase",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default 5)" },
        },
        required: ["query"],
      },
      async handler(args: unknown) {
        const { query, limit = 5 } = args as { query: string; limit?: number };
        try {
          const results = await client.search(query);
          return ok(results.slice(0, limit).map((r) => ({ path: r.filename, score: r.score, context: r.matches[0]?.context ?? "" })));
        } catch (error: unknown) {
          return err(error);
        }
      },
    },
    {
      name: "obsidian.read",
      description: "Read the full content of an Obsidian note by path",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the note (e.g. 'Projects/MyNote.md')" },
        },
        required: ["path"],
      },
      async handler(args: unknown) {
        const { path } = args as { path: string };
        try {
          const note = await client.read(path);
          return ok({ path: note.path, content: note.content });
        } catch (error: unknown) {
          return err(error);
        }
      },
    },
    {
      name: "obsidian.write",
      description: "Create or overwrite an Obsidian note",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Note path (e.g. 'WOPR/notes/MyNote.md')" },
          content: { type: "string", description: "Markdown content" },
        },
        required: ["path", "content"],
      },
      async handler(args: unknown) {
        const { path, content } = args as { path: string; content: string };
        try {
          await client.write(path, content);
          return ok({ success: true, path });
        } catch (error: unknown) {
          return err(error);
        }
      },
    },
    {
      name: "obsidian.append",
      description: "Append content to an existing Obsidian note",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Note path" },
          content: { type: "string", description: "Markdown content to append" },
        },
        required: ["path", "content"],
      },
      async handler(args: unknown) {
        const { path, content } = args as { path: string; content: string };
        try {
          await client.append(path, content);
          return ok({ success: true, path });
        } catch (error: unknown) {
          return err(error);
        }
      },
    },
    {
      name: "obsidian.list",
      description: "List notes in a folder in the Obsidian vault",
      inputSchema: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Folder path (empty for root)" },
        },
        required: [],
      },
      async handler(args: unknown) {
        const { folder = "" } = (args ?? {}) as { folder?: string };
        try {
          const files = await client.list(folder);
          return ok({ folder, files });
        } catch (error: unknown) {
          return err(error);
        }
      },
    },
  ];
}
