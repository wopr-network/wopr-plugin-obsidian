import type {
  ConfigSchema,
  MemorySearchEvent,
  MessageInfo,
  PluginManifest,
  SessionDestroyEvent,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";
import { buildA2ATools } from "./a2a-tools.js";
import { ObsidianClient } from "./obsidian-client.js";
import type { ObsidianConfig, ObsidianExtension } from "./types.js";

// Module-level state — null until init()
let ctx: WOPRPluginContext | null = null;
let client: ObsidianClient | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
const cleanups: Array<() => void> = [];

const configSchema: ConfigSchema = {
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
};

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

  // Capabilities this plugin provides — registered in capability registry on load
  // Other plugins can call ctx.hasCapability("vault") or ctx.getCapabilityProviders("vault")
  provides: {
    capabilities: [
      {
        type: "vault",
        id: "obsidian-vault",
        displayName: "Obsidian Vault",
        tier: "byok" as const,
        configSchema: {
          title: "Obsidian Vault",
          fields: [
            {
              name: "apiKey",
              type: "password",
              label: "Local REST API Key",
              required: true,
              secret: true,
              setupFlow: "paste",
            },
            { name: "port", type: "number", label: "Port", default: 27123, setupFlow: "none" },
          ],
        },
      },
    ],
  },

  // How to install Obsidian if not present (ordered by preference)
  install: [
    { kind: "brew", formula: "obsidian", label: "Install Obsidian (macOS via Homebrew)" },
    { kind: "script", url: "https://obsidian.md/download", label: "Download Obsidian (Linux/Windows)" },
    {
      kind: "manual",
      label: "Install Local REST API plugin (required)",
      instructions:
        "Open Obsidian → Settings → Community Plugins → turn off Safe Mode → Browse → search **Local REST API** → Install → Enable → copy the API key shown in plugin settings",
    },
  ],

  configSchema,

  setup: [
    {
      id: "install-obsidian",
      title: "Install Obsidian",
      description:
        "Download and install Obsidian from [obsidian.md](https://obsidian.md) or run `brew install obsidian` on macOS.\n\nThen open it and let it finish first-run setup.",
      optional: false,
    },
    {
      id: "install-local-rest-api",
      title: "Install Local REST API plugin",
      description:
        "Inside Obsidian:\n1. Open **Settings → Community Plugins**\n2. Disable Safe Mode if prompted\n3. Click **Browse** and search **Local REST API**\n4. Install and **Enable** it\n\nThe plugin will start an HTTP server on port 27123.",
      optional: false,
    },
    {
      id: "api-key",
      title: "Enter your API key",
      description:
        "In Obsidian, go to **Settings → Community Plugins → Local REST API** and copy the API key shown there.",
      optional: false,
      fields: {
        title: "API Key",
        fields: [
          {
            name: "apiKey",
            type: "password",
            label: "Local REST API Key",
            required: true,
            secret: true,
            description: "Found in Obsidian → Local REST API plugin settings",
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

  commands: [
    {
      name: "obsidian",
      description: "Manage the Obsidian vault integration",
      usage: "wopr obsidian <setup|status|test>",
      async handler(cmdCtx, args) {
        const [sub] = args;

        if (sub === "status") {
          const cfg = cmdCtx.getConfig<ObsidianConfig>();
          const c = new ObsidianClient(cfg.port ?? 27123, cfg.apiKey ?? "");
          const ok = await c.ping();
          console.log(`Obsidian: ${ok ? "✓ connected" : "✗ not reachable"}`);
          console.log(`  Port:    ${cfg.port ?? 27123}`);
          console.log(`  Vault:   ${cfg.vaultPath ?? "WOPR"}`);
          process.exit(ok ? 0 : 1);
        }

        if (sub === "test") {
          const cfg = cmdCtx.getConfig<ObsidianConfig>();
          const c = new ObsidianClient(cfg.port ?? 27123, cfg.apiKey ?? "");
          console.log("Testing connection to Obsidian Local REST API...");
          const ok = await c.ping();
          if (ok) {
            console.log("✓ Connected. Fetching vault root...");
            const files = await c.list();
            console.log(`✓ Vault contains ${files.length} item(s) at root.`);
          } else {
            console.error("✗ Could not connect. Is Obsidian running with Local REST API enabled?");
            process.exit(1);
          }
          process.exit(0);
        }

        if (sub === "setup") {
          const { createInterface } = await import("node:readline");
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));

          console.log("\n🪨  Obsidian Plugin Setup\n");
          console.log("Step 1: Install Obsidian");
          console.log("  macOS:   brew install obsidian");
          console.log("  Others:  https://obsidian.md/download\n");

          console.log("Step 2: Install the Local REST API plugin inside Obsidian");
          console.log("  Settings → Community Plugins → Browse → 'Local REST API' → Install → Enable\n");

          const apiKey = await ask("Step 3: Paste your Local REST API key: ");
          const portStr = await ask("Port (default 27123): ");
          const port = portStr.trim() ? Number(portStr.trim()) : 27123;

          rl.close();

          console.log("\nTesting connection...");
          const c = new ObsidianClient(port, apiKey.trim());
          const ok = await c.ping();

          if (!ok) {
            console.error("✗ Could not connect. Make sure Obsidian is running and the API key is correct.");
            process.exit(1);
          }

          await cmdCtx.saveConfig({ ...cmdCtx.getConfig<ObsidianConfig>(), apiKey: apiKey.trim(), port });
          console.log("✓ Connected and config saved. Run `wopr daemon restart` to activate.");
          process.exit(0);
        }

        console.log("Usage: wopr obsidian <setup|status|test>");
        process.exit(sub ? 1 : 0);
      },
    },
  ],

  async init(context: WOPRPluginContext) {
    ctx = context;

    ctx.registerConfigSchema("wopr-plugin-obsidian", configSchema);

    const config = ctx.getConfig<ObsidianConfig>();
    client = new ObsidianClient(config.port ?? 27123, config.apiKey ?? "");

    // Helper — safe accessor for post-init callbacks (ctx/client always set here)
    const getCtx = () => ctx as WOPRPluginContext;
    const getClient = () => client as ObsidianClient;

    // Health check loop — log connection state changes
    let lastConnected: boolean | null = null;
    healthTimer = setInterval(async () => {
      if (!client) return;
      const now = await client.ping();
      if (now !== lastConnected) {
        lastConnected = now;
        ctx?.log[now ? "info" : "warn"](`Obsidian vault ${now ? "connected" : "disconnected"}`);
      }
    }, 30_000);

    // Initial connection check (non-blocking)
    client
      .ping()
      .then((ok) => {
        ctx?.log[ok ? "info" : "warn"](
          `Obsidian vault ${ok ? "connected" : "not reachable — check Obsidian is running"}`,
        );
      })
      .catch(() => {});

    // Context provider — inject relevant vault notes into system prompt
    ctx.registerContextProvider({
      name: "obsidian",
      priority: 30,
      enabled: true,
      async getContext(_session: string, message: MessageInfo) {
        const cfg = getCtx().getConfig<ObsidianConfig>();
        if (cfg.injectContext !== "always") return null;
        if (!getClient().isConnected()) return null;

        const query = message.content;
        if (!query?.trim()) return null;

        try {
          const results = await getClient().search(query);
          const top = results.slice(0, cfg.maxContextNotes ?? 3);
          if (!top.length) return null;

          const notes = await Promise.all(
            top.map(async (r) => {
              try {
                const note = await getClient().read(r.filename);
                return `### ${r.filename}\n${note.content.slice(0, 2000)}`;
              } catch {
                return `### ${r.filename}\n*(could not read)*`;
              }
            }),
          );

          return {
            content: `## Relevant notes from your Obsidian vault:\n\n${notes.join("\n\n---\n\n")}`,
            role: "system" as const,
            metadata: { source: "obsidian", priority: 30, noteCount: top.length },
          };
        } catch (error: unknown) {
          ctx?.log.warn(`Obsidian context fetch failed: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      },
    });

    // memory:search event — augment semantic search results with vault matches
    const memUnsub = ctx.events.on("memory:search", async (payload: MemorySearchEvent) => {
      if (!client?.isConnected()) return;
      try {
        const results = await getClient().search(payload.query, 150);
        if (!payload.results) return;
        for (const r of results.slice(0, 3)) {
          (payload.results as Array<{ content: string; source: string; score: number }>).push({
            content: r.matches[0]?.context ?? r.filename,
            source: `obsidian:${r.filename}`,
            score: r.score,
          });
        }
      } catch {
        // non-fatal — memory search continues without Obsidian results
      }
    });
    cleanups.push(memUnsub as () => void);

    // session:destroy — optionally archive session to vault
    const sessionUnsub = ctx.events.on("session:destroy", async (payload: SessionDestroyEvent) => {
      const { session, history } = payload;
      const cfg = getCtx().getConfig<ObsidianConfig>();
      if (cfg.sessionArchive !== true && String(cfg.sessionArchive) !== "true") return;
      if (!client?.isConnected()) return;

      try {
        const date = new Date().toISOString().slice(0, 10);
        const path = `${cfg.vaultPath ?? "WOPR"}/sessions/${date}-${session}.md`;
        const lines = (history as Array<{ role: string; content: string }>)
          .map((m) => `**${m.role}:** ${m.content}`)
          .join("\n\n");
        await getClient().write(path, `# Session ${session}\n*${new Date().toISOString()}*\n\n${lines}`);
        ctx?.log.info(`Session archived to vault: ${path}`);
      } catch (error: unknown) {
        ctx?.log.warn(`Failed to archive session: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    cleanups.push(sessionUnsub as () => void);

    // Extension — exposes Obsidian API to other plugins
    const extension: ObsidianExtension = {
      search: (query, limit = 10) =>
        getClient()
          .search(query)
          .then((r) => r.slice(0, limit)),
      read: (path) => getClient().read(path),
      write: (path, content) => getClient().write(path, content),
      append: (path, content) => getClient().append(path, content),
      list: (folder) => getClient().list(folder),
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
      try {
        cleanup();
      } catch {
        /* ignore */
      }
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
