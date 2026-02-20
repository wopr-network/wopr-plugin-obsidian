export type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";

export interface ObsidianConfig {
  apiKey: string;
  port: number;
  vaultPath: string;
  injectContext: "always" | "on-demand" | "never";
  maxContextNotes: number;
  sessionArchive: boolean;
}

export interface ObsidianNote {
  path: string;
  content: string;
  stat: {
    ctime: number;
    mtime: number;
    size: number;
  };
}

export interface ObsidianSearchResult {
  filename: string;
  score: number;
  matches: Array<{
    match: { start: number; end: number };
    context: string;
  }>;
}

export interface ObsidianExtension {
  search(query: string, limit?: number): Promise<ObsidianSearchResult[]>;
  read(path: string): Promise<ObsidianNote>;
  write(path: string, content: string): Promise<void>;
  append(path: string, content: string): Promise<void>;
  list(folder?: string): Promise<string[]>;
  isConnected(): boolean;
}
