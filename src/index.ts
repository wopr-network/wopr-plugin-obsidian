import type { PluginManifest, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { buildA2ATools } from "./a2a-tools.js";
import { ObsidianClient } from "./obsidian-client.js";
import type { ObsidianConfig, ObsidianExtension } from "./types.js";

// Module-level state — null until init()
let ctx: WOPRPluginContext | null = null;
let client: ObsidianClient | null = null;
let healthTimer: NodeJS.Timeout | null = null;
const cleanups: Array<() => void> = [];

const manifest: PluginManifest = {
  name: "@wopr-network/wopr-plugin-obsidian",
  version: "1.0.0",
  description: "Obsidian vault integration — search, read, write notes, inject vault context into conversations",
  author: "wopr-network",
  license: "MIT",
  repository: "https://github.com/wopr-network/wopr-plugin-obsidian",
  homepage: "https://github.com/wopr-network/wopr-plugin-obsidian#readme",

  capabilities: ["memory", "utility"],
  category: "utilities",
  tags: ["obsidian", "notes", "memory", "vault", "knowledge-base", "pkm"],
  icon: "🪨",

  requires: {
    network: {
      outbound: true,
      inbound: false,
      hosts: ["127.0.0.1"],
      ports: [27123],
    },
    config: ["obsidian.apiKey"],
  },

  configSchema: {
    title: "Obsidian",
    description: "Connect to your local Obsidian vault via the Local REST API plugin",
    fields: [
      {
        name: "apiKey",
        type: "password",
        label: "Local REST API Key",
        placeholder: "...",
        required: true,
        secret: true,
        description: "Found in Obsidian → Community Plugins → Local REST API → Show API key",
        setupFlow: "paste",
      },
      {
        name: "port",
        type: "number",
        label: "Port",
        default: 27123,
        description: "Port the Obsidian Local REST API listens on (default: 27123)",
        setupFlow: "none",
      },
      {
        name: "vaultPath",
        type: "text",
        label: "WOPR folder in vault",
        placeholder: "WOPR",
        default: "WOPR",
        description: "Folder inside your vault where WOPR stores session archives",
        setupFlow: "none",
      },
      {
        name: "injectContext",
        type: "select",
        label: "Context injection",
        options: [
          { value: "always", label: "Always — inject relevant notes before every message" },
          { value: "on-demand", label: "On demand — available via A2A tools only" },
          { value: "never", label: "Disabled" },
        ],
        default: "always",
        setupFlow: "none",
      },
      {
        name: "maxContextNotes",
        type: "number",
        label: "Max notes injected per message",
        default: 3,
        setupFlow: "none",
      },
      {
        name: "sessionArchive",
        type: "select",
        label: "Archive sessions to vault",
        options: [
          { value: "true", label: "Yes — write session summaries to vault on end" },
          { value: "false", label: "No" },
        ],
        default: "false",
        setupFlow: "none",
      },
    ],
  },

  setup: [
    {
      id: "local-rest-api",
      title: "Install Obsidian Local REST API",
      description:
        "In Obsidian, open **Settings → Community Plugins → Browse**, search for **Local REST API**, install it, then copy your API key here.",
      fields: {
        title: "API Key",
        fields: [
          {
            name: "apiKey",
            type: "password",
            label: "Local REST API Key",
            required: true,
            secret: true,
            description: "Copy from Obsidian → Local REST API plugin settings",
            setupFlow: "paste",
          },
        ],
      },
    },
  ],

  lifecycle: {
    hotReload: false,
    shutdownBehavior: "graceful",
    shutdownTimeoutMs: 10_000,
  },

  minCoreVersion: "1.0.0",
};

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-obsidian",
  version: "1.0.0",
  description: manifest.description,
  manifest,

  async init(context: WOPRPluginContext) {
    ctx = context;

    ctx.registerConfigSchema("wopr-plugin-obsidian", manifest.configSchema!);

    const config = ctx.getConfig<ObsidianConfig>();
    client = new ObsidianClient(config.port ?? 27123, config.apiKey ?? "");

    // Health check loop — log connection state changes
    let lastConnected: boolean | null = null;
    healthTimer = setInterval(async () => {
      const now = await client!.ping();
      if (now !== lastConnected) {
        lastConnected = now;
        ctx?.log[now ? "info" : "warn"](`Obsidian vault ${now ? "connected" : "disconnected"}`);
      }
    }, 30_000);

    // Initial connection check (non-blocking)
    client.ping().then((ok) => {
      ctx?.log[ok ? "info" : "warn"](`Obsidian vault ${ok ? "connected" : "not reachable — check Obsidian is running"}`);
    }).catch(() => {});

    // Context provider — inject relevant vault notes into system prompt
    ctx.registerContextProvider({
      name: "obsidian",
      priority: 30,
      enabled: true,
      async getContext(messageInfo?) {
        const cfg = ctx!.getConfig<ObsidianConfig>();
        if (cfg.injectContext !== "always") return null;
        if (!client?.isConnected()) return null;

        const query = messageInfo?.message;
        if (!query?.trim()) return null;

        try {
          const results = await client.search(query);
          const top = results.slice(0, cfg.maxContextNotes ?? 3);
          if (!top.length) return null;

          const notes = await Promise.all(
            top.map(async (r) => {
              try {
                const note = await client!.read(r.filename);
                return `### ${r.filename}\n${note.content.slice(0, 2000)}`;
              } catch {
                return `### ${r.filename}\n*(could not read)*`;
              }
            }),
          );

          return {
            content: `## Relevant notes from your Obsidian vault:\n\n${notes.join("\n\n---\n\n")}`,
            role: "system" as const,
            metadata: { source: "obsidian", noteCount: top.length },
          };
        } catch (error: unknown) {
          ctx?.log.warn(`Obsidian context fetch failed: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      },
    });

    // memory:search event — augment semantic search results with vault matches
    const memUnsub = ctx.events.on("memory:search", async (payload) => {
      if (!client?.isConnected()) return;
      try {
        const results = await client.search(payload.query, 150);
        for (const r of results.slice(0, 3)) {
          payload.results.push({
            content: r.matches[0]?.context ?? r.filename,
            source: `obsidian:${r.filename}`,
            score: r.score,
          } as never);
        }
      } catch {
        // non-fatal — memory search continues without Obsidian results
      }
    });
    cleanups.push(memUnsub as () => void);

    // session:destroy — optionally archive session to vault
    const sessionUnsub = ctx.events.on("session:destroy", async ({ session, history }) => {
      const cfg = ctx!.getConfig<ObsidianConfig>();
      if (cfg.sessionArchive !== true && String(cfg.sessionArchive) !== "true") return;
      if (!client?.isConnected()) return;

      try {
        const date = new Date().toISOString().slice(0, 10);
        const path = `${cfg.vaultPath ?? "WOPR"}/sessions/${date}-${session}.md`;
        const lines = (history as Array<{ role: string; content: string }>)
          .map((m) => `**${m.role}:** ${m.content}`)
          .join("\n\n");
        await client.write(path, `# Session ${session}\n*${new Date().toISOString()}*\n\n${lines}`);
        ctx?.log.info(`Session archived to vault: ${path}`);
      } catch (error: unknown) {
        ctx?.log.warn(`Failed to archive session: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    cleanups.push(sessionUnsub as () => void);

    // Extension — exposes Obsidian API to other plugins
    const extension: ObsidianExtension = {
      search: (query, limit = 10) => client!.search(query).then((r) => r.slice(0, limit)),
      read: (path) => client!.read(path),
      write: (path, content) => client!.write(path, content),
      append: (path, content) => client!.append(path, content),
      list: (folder) => client!.list(folder),
      isConnected: () => client?.isConnected() ?? false,
    };
    ctx.registerExtension("obsidian", extension);

    // A2A tools
    if (ctx.registerA2AServer) {
      ctx.registerA2AServer({
        name: "obsidian",
        version: "1.0",
        tools: buildA2ATools(client),
      });
    }

    ctx.log.info("wopr-plugin-obsidian initialized");
  },

  async shutdown() {
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }

    for (const cleanup of cleanups) {
      try { cleanup(); } catch { /* ignore */ }
    }
    cleanups.length = 0;

    ctx?.unregisterConfigSchema("wopr-plugin-obsidian");
    ctx?.unregisterContextProvider("obsidian");
    ctx?.unregisterExtension("obsidian");

    client = null;
    ctx = null;
  },
};

export default plugin;
