import { describe, expect, it, vi } from "vitest";
import { buildA2ATools } from "../src/a2a-tools.js";
import type { ObsidianClient } from "../src/obsidian-client.js";

function makeClient(overrides: Partial<ObsidianClient> = {}): ObsidianClient {
  return {
    isConnected: () => true,
    ping: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
    append: vi.fn(),
    search: vi.fn(),
    list: vi.fn(),
    ...overrides,
  } as unknown as ObsidianClient;
}

describe("A2A tools", () => {
  describe("obsidian.search", () => {
    it("returns formatted results", async () => {
      const client = makeClient({
        search: vi.fn().mockResolvedValue([
          { filename: "Notes/A.md", score: 0.9, matches: [{ match: { start: 0, end: 3 }, context: "foo context" }] },
          { filename: "Notes/B.md", score: 0.7, matches: [] },
        ]),
      });
      const tools = buildA2ATools(client);
      const tool = tools.find((t) => t.name === "obsidian.search")!;
      const result = await tool.handler({ query: "foo", limit: 2 });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(2);
      expect(data[0].path).toBe("Notes/A.md");
      expect(data[0].context).toBe("foo context");
    });

    it("returns error on failure", async () => {
      const client = makeClient({ search: vi.fn().mockRejectedValue(new Error("timeout")) });
      const tools = buildA2ATools(client);
      const tool = tools.find((t) => t.name === "obsidian.search")!;
      const result = await tool.handler({ query: "foo" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("timeout");
    });
  });

  describe("obsidian.read", () => {
    it("returns note content", async () => {
      const client = makeClient({
        read: vi.fn().mockResolvedValue({ path: "Notes/A.md", content: "# Hello", stat: {} }),
      });
      const tools = buildA2ATools(client);
      const tool = tools.find((t) => t.name === "obsidian.read")!;
      const result = await tool.handler({ path: "Notes/A.md" });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.content).toBe("# Hello");
    });
  });

  describe("obsidian.write", () => {
    it("writes and returns success", async () => {
      const write = vi.fn().mockResolvedValue(undefined);
      const client = makeClient({ write });
      const tools = buildA2ATools(client);
      const tool = tools.find((t) => t.name === "obsidian.write")!;
      const result = await tool.handler({ path: "WOPR/test.md", content: "# Test" });
      expect(result.isError).toBeFalsy();
      expect(write).toHaveBeenCalledWith("WOPR/test.md", "# Test");
    });
  });

  describe("obsidian.append", () => {
    it("appends and returns success", async () => {
      const append = vi.fn().mockResolvedValue(undefined);
      const client = makeClient({ append });
      const tools = buildA2ATools(client);
      const tool = tools.find((t) => t.name === "obsidian.append")!;
      const result = await tool.handler({ path: "WOPR/test.md", content: "\nmore" });
      expect(result.isError).toBeFalsy();
      expect(append).toHaveBeenCalledWith("WOPR/test.md", "\nmore");
    });
  });

  describe("obsidian.list", () => {
    it("lists files in folder", async () => {
      const client = makeClient({ list: vi.fn().mockResolvedValue(["WOPR/a.md", "WOPR/b.md"]) });
      const tools = buildA2ATools(client);
      const tool = tools.find((t) => t.name === "obsidian.list")!;
      const result = await tool.handler({ folder: "WOPR" });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.files).toEqual(["WOPR/a.md", "WOPR/b.md"]);
    });

    it("defaults to root when no folder given", async () => {
      const list = vi.fn().mockResolvedValue([]);
      const client = makeClient({ list });
      const tools = buildA2ATools(client);
      const tool = tools.find((t) => t.name === "obsidian.list")!;
      await tool.handler({});
      expect(list).toHaveBeenCalledWith("");
    });
  });
});
