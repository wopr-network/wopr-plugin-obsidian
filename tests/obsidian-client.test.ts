import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObsidianClient } from "../src/obsidian-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? "OK" : "Error", json: () => Promise.resolve(body) };
}

describe("ObsidianClient", () => {
  let client: ObsidianClient;

  beforeEach(() => {
    client = new ObsidianClient(27123, "test-key");
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ping returns true when server responds ok", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}));
    expect(await client.ping()).toBe(true);
    expect(client.isConnected()).toBe(true);
  });

  it("ping returns false when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await client.ping()).toBe(false);
    expect(client.isConnected()).toBe(false);
  });

  it("read fetches note content", async () => {
    const note = { path: "Notes/Test.md", content: "hello", stat: { ctime: 0, mtime: 0, size: 5 } };
    mockFetch.mockResolvedValueOnce(makeResponse(note));
    const result = await client.read("Notes/Test.md");
    expect(result.content).toBe("hello");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/vault/Notes%2FTest.md"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }),
    );
  });

  it("write sends PUT request", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(null));
    await client.write("WOPR/test.md", "# Hello");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/vault/"),
      expect.objectContaining({ method: "PUT", body: "# Hello" }),
    );
  });

  it("append sends POST request", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(null));
    await client.append("WOPR/test.md", "\nmore");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/vault/"),
      expect.objectContaining({ method: "POST", body: "\nmore" }),
    );
  });

  it("search returns results", async () => {
    const results = [{ filename: "Notes/A.md", score: 0.9, matches: [{ match: { start: 0, end: 5 }, context: "hello" }] }];
    mockFetch.mockResolvedValueOnce(makeResponse(results));
    const out = await client.search("hello");
    expect(out).toHaveLength(1);
    expect(out[0].filename).toBe("Notes/A.md");
  });

  it("read throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}, false, 404));
    await expect(client.read("missing.md")).rejects.toThrow("404");
  });
});
