import type { ObsidianNote, ObsidianSearchResult } from "./types.js";

export class ObsidianClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private connected = false;

  constructor(port: number, apiKey: string) {
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/`, { headers: this.headers });
      this.connected = res.ok;
      return this.connected;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async read(path: string): Promise<ObsidianNote> {
    const res = await fetch(`${this.baseUrl}/vault/${encodeURIComponent(path)}`, {
      headers: { ...this.headers, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Failed to read note "${path}": ${res.status} ${res.statusText}`);
    return res.json() as Promise<ObsidianNote>;
  }

  async write(path: string, content: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/vault/${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { ...this.headers, "Content-Type": "text/markdown" },
      body: content,
    });
    if (!res.ok) throw new Error(`Failed to write note "${path}": ${res.status} ${res.statusText}`);
  }

  async append(path: string, content: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/vault/${encodeURIComponent(path)}`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "text/markdown" },
      body: content,
    });
    if (!res.ok) throw new Error(`Failed to append to note "${path}": ${res.status} ${res.statusText}`);
  }

  async search(query: string, contextLength = 200): Promise<ObsidianSearchResult[]> {
    const url = new URL(`${this.baseUrl}/search/simple/`);
    url.searchParams.set("query", query);
    url.searchParams.set("contextLength", String(contextLength));

    const res = await fetch(url.toString(), { headers: this.headers });
    if (!res.ok) throw new Error(`Search failed: ${res.status} ${res.statusText}`);
    return res.json() as Promise<ObsidianSearchResult[]>;
  }

  async list(folder = ""): Promise<string[]> {
    const path = folder ? `${encodeURIComponent(folder)}/` : "";
    const res = await fetch(`${this.baseUrl}/vault/${path}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Failed to list folder "${folder}": ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { files: string[] };
    return data.files ?? [];
  }
}
