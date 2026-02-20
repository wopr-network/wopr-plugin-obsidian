# wopr-plugin-obsidian

Obsidian vault integration for WOPR. Connects to a local Obsidian instance via the
[Local REST API plugin](https://github.com/coddingtonbear/obsidian-local-rest-api) and provides:

- **Context provider** — searches vault and injects relevant notes into every system prompt
- **A2A tools** — `obsidian.search`, `obsidian.read`, `obsidian.write`, `obsidian.append`, `obsidian.list`
- **Extension** — typed `ObsidianExtension` API for other plugins via `ctx.getExtension("obsidian")`
- **Memory augmentation** — listens to `memory:search` and adds vault matches to results
- **Session archive** — optionally writes session history to vault on `session:destroy`

## Build commands

```bash
bun install          # install deps
bun run build        # tsc → dist/
bun run check        # biome + tsc --noEmit
bun run test         # vitest run
bun run lint:fix     # auto-fix lint issues
```

## Architecture

```
src/
  index.ts              # WOPRPlugin default export — orchestration only
  obsidian-client.ts    # HTTP client wrapping Obsidian Local REST API
  a2a-tools.ts          # A2A tool definitions (search/read/write/append/list)
  types.ts              # ObsidianConfig, ObsidianNote, ObsidianExtension interfaces
tests/
  obsidian-client.test.ts
  a2a-tools.test.ts
```

## Key details

- **No Drizzle, no SQLite** — this plugin has no local storage; Obsidian IS the storage
- **Imports only from `@wopr-network/plugin-types`** — never relative paths into core
- **Health check**: polls Obsidian every 30s, logs connection state changes
- **Context injection is optional**: config `injectContext: "always" | "on-demand" | "never"`
- **Session archive is opt-in**: config `sessionArchive: true`
- The Obsidian Local REST API runs on `http://127.0.0.1:27123` by default (configurable)
- `catch (error: unknown)` everywhere — never `catch (error: any)`
- `shutdown()` is idempotent — safe to call twice

## Prerequisites for users

1. Obsidian installed and running
2. Community plugin: **Local REST API** installed and enabled
3. API key copied from plugin settings into WOPR config

## Issue tracking

All issues in Linear (team: WOPR).
Descriptions must start with `**Repo:** wopr-network/wopr-plugin-obsidian`
